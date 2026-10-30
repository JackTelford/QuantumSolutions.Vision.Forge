import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProtocolError, errorResponse, isNotification, isRequest, isResponse, notification, parseMessage, resultResponse, serializeMessage } from '../../src/mcp/jsonrpc.ts';
import { JsonRpcErrorCodes } from '../../src/mcp/types.ts';

describe('parseMessage', () => {
  it('reads a request with a string or a number id, keeping its params', () => {
    const outcome = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"a":1}}');
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(isRequest(outcome.message), true);
    assert.equal(isNotification(outcome.message), false);
    assert.equal(isResponse(outcome.message), false);
    assert.deepEqual(outcome.message, { jsonrpc: '2.0', id: 1, method: 'ping', params: { a: 1 } });
    const named = parseMessage('{"jsonrpc":"2.0","id":"abc","method":"ping"}');
    assert.equal(named.ok && isRequest(named.message) && named.message.id === 'abc', true);
  });

  it('reads a message without an id as a notification', () => {
    const outcome = parseMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(isNotification(outcome.message), true);
    assert.equal(isRequest(outcome.message), false);
  });

  it('reads a result and an error response', () => {
    const result = parseMessage('{"jsonrpc":"2.0","id":3,"result":{}}');
    assert.equal(result.ok && isResponse(result.message), true);
    const error = parseMessage('{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"bad"}}');
    assert.equal(error.ok, true);
    if (!error.ok) return;
    assert.equal(isResponse(error.message), true);
    assert.deepEqual(error.message, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'bad' } });
  });

  it('answers text that is not JSON with a parse error on a null id', () => {
    const outcome = parseMessage('{not json');
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.id, null);
    assert.equal(outcome.error.code, JsonRpcErrorCodes.parseError);
    assert.match(outcome.error.message, /Parse error/);
  });

  it('refuses a batch, a non-object and a wrong jsonrpc version as invalid requests', () => {
    for (const line of ['[]', '"hello"', '42', 'null']) {
      const outcome = parseMessage(line);
      assert.equal(outcome.ok, false, line);
      if (!outcome.ok) assert.equal(outcome.error.code, JsonRpcErrorCodes.invalidRequest, line);
    }
    const version = parseMessage('{"jsonrpc":"1.0","id":7,"method":"ping"}');
    assert.equal(version.ok, false);
    if (!version.ok) {
      assert.equal(version.id, 7, 'the id is kept so the client can match the error');
      assert.match(version.error.message, /"jsonrpc" must be "2.0"/);
    }
  });

  it('refuses a method that is not a string, an id of the wrong type and a message with neither method nor result', () => {
    const method = parseMessage('{"jsonrpc":"2.0","id":1,"method":5}');
    assert.equal(!method.ok && /"method"/.test(method.error.message), true);
    const id = parseMessage('{"jsonrpc":"2.0","id":{"x":1},"method":"ping"}');
    assert.equal(!id.ok && id.id === null && /"id"/.test(id.error.message), true);
    const neither = parseMessage('{"jsonrpc":"2.0","id":1}');
    assert.equal(!neither.ok && neither.error.code === JsonRpcErrorCodes.invalidRequest, true);
  });
});

describe('serializeMessage and the builders', () => {
  it('serializes a message to one line even when a string carries line breaks', () => {
    const text = serializeMessage(resultResponse(1, { text: 'a\nb\r\nc' }));
    assert.equal(text.includes('\n'), false);
    assert.deepEqual(JSON.parse(text), { jsonrpc: '2.0', id: 1, result: { text: 'a\nb\r\nc' } });
  });

  it('builds error responses with data only when given', () => {
    assert.deepEqual(errorResponse(2, -32601, 'Method not found'), { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } });
    assert.deepEqual(errorResponse(null, -32602, 'Bad', { field: 'name' }), { jsonrpc: '2.0', id: null, error: { code: -32602, message: 'Bad', data: { field: 'name' } } });
  });

  it('builds notifications with params only when given', () => {
    assert.deepEqual(notification('notifications/initialized'), { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.deepEqual(notification('notifications/progress', { progress: 1 }), { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } });
  });

  it('a ProtocolError carries the code it is answered with', () => {
    const error = new ProtocolError(JsonRpcErrorCodes.invalidParams, 'Invalid params', { field: 'uri' });
    assert.equal(error.code, -32602);
    assert.equal(error.message, 'Invalid params');
    assert.deepEqual(error.data, { field: 'uri' });
    assert.equal(error instanceof Error, true);
  });
});
