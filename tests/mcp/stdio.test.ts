import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { StdioTransport } from '../../src/mcp/transport.ts';
import type { JsonRpcMessage, JsonRpcResponse } from '../../src/mcp/types.ts';
import { LineReader } from './line-reader.ts';

interface Rig {
  readonly input: PassThrough;
  readonly transport: StdioTransport;
  readonly received: JsonRpcMessage[];
  readonly written: LineReader;
  closed: number;
}

/** A transport over two PassThrough streams, started, with everything it receives and writes collected. */
function rig(): Rig {
  const input = new PassThrough();
  const output = new PassThrough();
  const written = new LineReader();
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => { written.feed(chunk); });
  const r: Rig = { input, transport: new StdioTransport(input, output), received: [], written, closed: 0 };
  r.transport.start((message) => { r.received.push(message); }, () => { r.closed += 1; });
  return r;
}

function tick(ms = 10): Promise<void> {
  return new Promise<void>((done) => setTimeout(done, ms));
}

describe('StdioTransport over PassThrough streams', () => {
  it('joins partial chunks, accepts CRLF, skips blank lines and answers a malformed line itself', async () => {
    const { input, transport, received, written } = rig();
    input.write('{"jsonrpc":"2.0","id":1,"me');
    input.write('thod":"ping"}\r\n\r\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{oops\n[]\n');
    await tick();
    transport.send({ jsonrpc: '2.0', id: 1, result: {} });
    await tick();

    assert.deepEqual(received, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]);
    const messages = written.messages();
    assert.equal(messages.length, 3);
    assert.equal(messages[0]?.id, null);
    assert.equal(messages[0]?.error?.code, -32700);
    assert.match(messages[0]?.error?.message ?? '', /^Parse error/);
    assert.equal(messages[1]?.id, null);
    assert.equal(messages[1]?.error?.code, -32600);
    assert.match(messages[1]?.error?.message ?? '', /batches are not supported/);
    assert.deepEqual(messages[2], { jsonrpc: '2.0', id: 1, result: {} });
    transport.close();
  });

  it('closes once when input ends, drops an unterminated final line and writes nothing afterwards', async () => {
    const r = rig();
    r.input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}');
    r.input.end();
    await tick(20);

    assert.deepEqual(r.received, [{ jsonrpc: '2.0', id: 1, method: 'ping' }], 'the line without a newline is not delivered: the client that sent it has gone');
    assert.equal(r.closed, 1);
    r.transport.send({ jsonrpc: '2.0', id: 1, result: {} });
    r.transport.send({ jsonrpc: '2.0', id: 2, result: {} });
    r.transport.close();
    await tick();
    assert.equal(r.closed, 1, 'onClose fires once');
    assert.deepEqual(r.written.lines, [], 'nothing is written after close, so neither the delivered ping nor the dropped one is answered');
  });

  it('close() stops delivery, fires onClose once and leaves the output stream open for its owner', async () => {
    const r = rig();
    r.input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    await tick();
    r.transport.close();
    r.transport.close();
    r.input.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    await tick();

    assert.equal(r.closed, 1);
    assert.deepEqual(r.received.map((message) => ('id' in message ? message.id : null)), [1], 'a line written after close is not delivered');
    const response: JsonRpcResponse = { jsonrpc: '2.0', id: 1, result: {} };
    r.transport.send(response);
    await tick();
    assert.deepEqual(r.written.lines, []);
  });
});
