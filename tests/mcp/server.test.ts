import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CancelledError, VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import { isResponse } from '../../src/mcp/jsonrpc.ts';
import { McpServer } from '../../src/mcp/server.ts';
import type { Transport } from '../../src/mcp/transport.ts';
import type { JsonRpcId, JsonRpcMessage, JsonRpcNotification, JsonRpcResponse, ServerRegistry, ToolCallContext, ToolResult } from '../../src/mcp/types.ts';

/** A transport the test drives by hand: messages in through deliver, messages out into sent. */
class FakeTransport implements Transport {
  readonly sent: JsonRpcMessage[] = [];
  private onMessage: ((message: JsonRpcMessage) => void) | undefined;
  private onClose: (() => void) | undefined;

  start(onMessage: (message: JsonRpcMessage) => void, onClose: () => void): void {
    this.onMessage = onMessage;
    this.onClose = onClose;
  }

  send(message: JsonRpcMessage): void {
    this.sent.push(message);
  }

  close(): void {
    this.onClose?.();
  }

  deliver(message: JsonRpcMessage): void {
    this.onMessage?.(message);
  }

  request(id: JsonRpcId, method: string, params?: unknown): Promise<JsonRpcResponse> {
    this.deliver(params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params });
    return this.response(id);
  }

  async response(id: JsonRpcId): Promise<JsonRpcResponse> {
    await until(() => this.find(id) !== undefined);
    const found = this.find(id);
    if (found === undefined) throw new Error(`No response for ${String(id)}.`);
    return found;
  }

  notifications(method: string): JsonRpcNotification[] {
    return this.sent.filter((message): message is JsonRpcNotification => 'method' in message && message.method === method);
  }

  private find(id: JsonRpcId): JsonRpcResponse | undefined {
    return this.sent.find((message): message is JsonRpcResponse => isResponse(message) && message.id === id);
  }
}

interface CallRecord { readonly tool: string; start: number; end: number; aborted: boolean }

async function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting.');
    await new Promise<void>((done) => setTimeout(done, 5));
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((done, fail) => {
    if (signal.aborted) { fail(new CancelledError()); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); done(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); fail(new CancelledError()); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function fakeRegistry(records: CallRecord[]): ServerRegistry {
  const track = async (tool: string, ms: number, context: ToolCallContext): Promise<void> => {
    const record: CallRecord = { tool, start: Date.now(), end: 0, aborted: false };
    records.push(record);
    context.signal.addEventListener('abort', () => { record.aborted = true; }, { once: true });
    await sleep(ms, context.signal);
    record.end = Date.now();
  };
  return {
    instructions: 'Follow the flow.',
    tools: [
      {
        name: 'echo',
        description: 'Echoes its input.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' }, fail: { type: 'boolean' }, crash: { type: 'boolean' }, late: { type: 'boolean' }, waitMs: { type: 'number' } } },
        annotations: { readOnlyHint: true },
        async run(input, context): Promise<ToolResult> {
          context.report('one');
          context.report('two');
          if (input['fail'] === true) throw new VisionForgeError({ code: 'fake', message: 'It broke.', hint: 'Turn it off and on.' });
          if (input['crash'] === true) throw new Error('boom');
          if (input['late'] === true) setTimeout(() => { context.report('late'); }, 10);
          const waitMs = input['waitMs'];
          await track('echo', typeof waitMs === 'number' ? waitMs : 0, context);
          return { content: [{ type: 'text', text: JSON.stringify(input) }], structuredContent: { echoed: input } };
        },
      },
      {
        name: 'slow',
        description: 'Renders slowly and exclusively.',
        inputSchema: { type: 'object', properties: { ms: { type: 'number' } }, required: ['ms'] },
        exclusive: true,
        async run(input, context): Promise<ToolResult> {
          const ms = input['ms'];
          await track('slow', typeof ms === 'number' ? ms : 50, context);
          return { content: [{ type: 'text', text: 'done' }] };
        },
      },
    ],
    resources: [
      { uri: 'vision-forge://references/test.md', name: 'test', description: 'A test page.', mimeType: 'text/markdown', read: async (): Promise<string> => '# hello' },
      { uri: 'vision-forge://references/broken.md', name: 'broken', mimeType: 'text/markdown', read: async (): Promise<string> => { throw new Error('disk gone'); } },
    ],
    prompts: [{
      name: 'cinematic-studio',
      description: 'Directs a production.',
      arguments: [{ name: 'brief', description: 'The brief.', required: true }],
      get: async (args): Promise<readonly { role: 'user'; content: { type: 'text'; text: string } }[]> => [{ role: 'user', content: { type: 'text', text: `Brief: ${args['brief'] ?? ''}` } }],
    }],
  };
}

interface Rig { readonly transport: FakeTransport; readonly server: McpServer; readonly records: CallRecord[]; readonly unexpected: unknown[]; readonly started: Promise<void> }

function rig(): Rig {
  const records: CallRecord[] = [];
  const unexpected: unknown[] = [];
  const transport = new FakeTransport();
  const server = new McpServer(fakeRegistry(records), { name: 'vision-forge', title: 'Vision.Forge', version: '9.9.9' }, { dataDir: 'D', outDir: 'O', repositoryRoot: 'R' }, transport, { onUnexpected: (error) => { unexpected.push(error); } });
  return { transport, server, records, unexpected, started: server.start() };
}

async function initialized(version = '2025-06-18'): Promise<Rig> {
  const r = rig();
  await r.transport.request(0, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  r.transport.deliver({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return r;
}

function resultOf(response: JsonRpcResponse): Record<string, unknown> {
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  return response.result as Record<string, unknown>;
}

describe('McpServer', () => {
  it('answers initialize with the client version when known, the server identity, its capabilities and the instructions', async () => {
    const { transport, server } = rig();
    const result = resultOf(await transport.request(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'c', version: '1' } }));
    assert.equal(result['protocolVersion'], '2025-03-26');
    assert.deepEqual(result['serverInfo'], { name: 'vision-forge', title: 'Vision.Forge', version: '9.9.9' });
    assert.deepEqual(result['capabilities'], { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false }, logging: {} });
    assert.equal(result['instructions'], 'Follow the flow.');
    server.close();
  });

  it('answers an unknown client version with the newest supported one', async () => {
    const { transport, server } = rig();
    const result = resultOf(await transport.request(1, 'initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'c', version: '1' } }));
    assert.equal(result['protocolVersion'], '2025-06-18');
    server.close();
  });

  it('refuses initialize without a protocolVersion, naming the field', async () => {
    const { transport, server } = rig();
    const response = await transport.request(1, 'initialize', { capabilities: {} });
    assert.equal(response.error?.code, -32602);
    assert.match(response.error?.message ?? '', /"protocolVersion"/);
    server.close();
  });

  it('answers ping with an empty result, before and after initialize', async () => {
    const { transport, server } = rig();
    assert.deepEqual(resultOf(await transport.request(1, 'ping')), {});
    server.close();
    const ready = await initialized();
    assert.deepEqual(resultOf(await ready.transport.request(2, 'ping')), {});
    ready.server.close();
  });

  it('refuses any other request before initialize with -32600', async () => {
    const { transport, server } = rig();
    const response = await transport.request(1, 'tools/list');
    assert.equal(response.error?.code, -32600);
    assert.match(response.error?.message ?? '', /not initialized/i);
    server.close();
  });

  it('lists tools with name, description, input schema and annotations', async () => {
    const { transport, server } = await initialized();
    const result = resultOf(await transport.request(1, 'tools/list'));
    const tools = result['tools'] as readonly Record<string, unknown>[];
    assert.deepEqual(tools.map((tool) => tool['name']), ['echo', 'slow']);
    assert.deepEqual(Object.keys(tools[0] ?? {}).sort(), ['annotations', 'description', 'inputSchema', 'name']);
    assert.deepEqual(Object.keys(tools[1] ?? {}).sort(), ['description', 'inputSchema', 'name']);
    assert.deepEqual((tools[1]?.['inputSchema'] as Record<string, unknown>)['required'], ['ms']);
    server.close();
  });

  it('calls a tool and returns its content and structuredContent', async () => {
    const { transport, server } = await initialized();
    const result = resultOf(await transport.request(1, 'tools/call', { name: 'echo', arguments: { text: 'hi' } }));
    assert.deepEqual(result['structuredContent'], { echoed: { text: 'hi' } });
    assert.deepEqual(result['content'], [{ type: 'text', text: '{"text":"hi"}' }]);
    assert.equal(result['isError'], undefined);
    server.close();
  });

  it('sends progress notifications in order under the request progress token, before the response', async () => {
    const { transport, server } = await initialized();
    await transport.request(1, 'tools/call', { name: 'echo', arguments: {}, _meta: { progressToken: 'tok' } });
    const progress = transport.notifications('notifications/progress');
    assert.deepEqual(progress.map((n) => n.params), [{ progressToken: 'tok', progress: 1, message: 'one' }, { progressToken: 'tok', progress: 2, message: 'two' }]);
    const lastProgressAt = transport.sent.lastIndexOf(progress[progress.length - 1] ?? transport.sent[0] ?? { jsonrpc: '2.0', method: 'none' });
    assert.ok(lastProgressAt < transport.sent.findIndex((m) => isResponse(m) && m.id === 1), 'every progress line was sent before the response');
    assert.equal(transport.notifications('notifications/message').length, 0);
    server.close();
  });

  it('sends progress as info log messages when the request carries no progress token, and none once the level is raised', async () => {
    const { transport, server } = await initialized();
    await transport.request(1, 'tools/call', { name: 'echo', arguments: {} });
    assert.deepEqual(transport.notifications('notifications/message').map((n) => n.params), [{ level: 'info', logger: 'echo', data: 'one' }, { level: 'info', logger: 'echo', data: 'two' }]);
    assert.deepEqual(resultOf(await transport.request(2, 'logging/setLevel', { level: 'warning' })), {});
    await transport.request(3, 'tools/call', { name: 'echo', arguments: {} });
    assert.equal(transport.notifications('notifications/message').length, 2);
    const bad = await transport.request(4, 'logging/setLevel', { level: 'loud' });
    assert.equal(bad.error?.code, -32602);
    assert.match(bad.error?.message ?? '', /"level"/);
    server.close();
  });

  it('turns a thrown tool error into a result with isError, the message and the hint', async () => {
    const { transport, server, unexpected } = await initialized();
    const result = resultOf(await transport.request(1, 'tools/call', { name: 'echo', arguments: { fail: true } }));
    assert.equal(result['isError'], true);
    assert.deepEqual(result['content'], [{ type: 'text', text: 'It broke.\nTurn it off and on.' }]);
    const structured = result['structuredContent'] as Record<string, unknown>;
    assert.equal(structured['ok'], false);
    assert.deepEqual(structured['errors'], [{ code: 'fake', message: 'It broke.', hint: 'Turn it off and on.' }]);
    assert.deepEqual(unexpected, [], 'a coded error is expected and does not reach the hook');
    server.close();
  });

  it('a tool throwing a plain Error is answered with a hint that points at standard error, and the error reaches the onUnexpected hook', async () => {
    const { transport, server, unexpected } = await initialized();
    const result = resultOf(await transport.request(1, 'tools/call', { name: 'echo', arguments: { crash: true } }));
    assert.equal(result['isError'], true);
    assert.deepEqual(result['content'], [{ type: 'text', text: "boom\nThis was not expected; the details are on the server's standard error." }]);
    assert.doesNotMatch(JSON.stringify(result), /log file/, 'the CLI hint about a log file is not sent: the server writes none');
    assert.equal(unexpected.length, 1);
    assert.equal((unexpected[0] as Error).message, 'boom');
    server.close();
  });

  it('stops forwarding a tool report once the call has been answered', async () => {
    const { transport, server } = await initialized();
    await transport.request(1, 'tools/call', { name: 'echo', arguments: { late: true }, _meta: { progressToken: 'tok' } });
    await new Promise<void>((done) => setTimeout(done, 40));
    assert.deepEqual(transport.notifications('notifications/progress').map((n) => (n.params as Record<string, unknown>)['message']), ['one', 'two'], 'the late report after the response is dropped');
    assert.equal(transport.sent.findIndex((m) => isResponse(m) && m.id === 1), transport.sent.length - 1, 'nothing follows the response');
    server.close();
  });

  it('answers an unknown tool with -32602 and bad params with -32602 naming the field', async () => {
    const { transport, server } = await initialized();
    const unknown = await transport.request(1, 'tools/call', { name: 'explode', arguments: {} });
    assert.equal(unknown.error?.code, -32602);
    assert.match(unknown.error?.message ?? '', /Unknown tool "explode"/);
    const noName = await transport.request(2, 'tools/call', { arguments: {} });
    assert.equal(noName.error?.code, -32602);
    assert.match(noName.error?.message ?? '', /"name"/);
    const badArguments = await transport.request(3, 'tools/call', { name: 'echo', arguments: 'x' });
    assert.match(badArguments.error?.message ?? '', /"arguments"/);
    server.close();
  });

  it('answers an unknown method with -32601 and ignores unknown notifications and responses', async () => {
    const { transport, server } = await initialized();
    transport.deliver({ jsonrpc: '2.0', method: 'notifications/whatever' });
    transport.deliver({ jsonrpc: '2.0', id: 'x', result: {} });
    const response = await transport.request(1, 'sampling/createMessage');
    assert.equal(response.error?.code, -32601);
    assert.match(response.error?.message ?? '', /sampling\/createMessage/);
    assert.equal(transport.sent.filter(isResponse).length, 2, 'only initialize and this request were answered');
    server.close();
  });

  it('a cancelled notification aborts the tool signal and the request gets no response', async () => {
    const { transport, server, records } = await initialized();
    transport.deliver({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'slow', arguments: { ms: 5000 } } });
    await until(() => records.length === 1);
    transport.deliver({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9, reason: 'user' } });
    await until(() => records[0]?.aborted === true);
    await new Promise<void>((done) => setTimeout(done, 30));
    assert.equal(transport.sent.some((m) => isResponse(m) && m.id === 9), false);
    assert.deepEqual(resultOf(await transport.request(10, 'ping')), {}, 'the server keeps serving');
    server.close();
  });

  it('a cancelled notification for an unknown request id is ignored and the server keeps serving', async () => {
    const { transport, server } = await initialized();
    const sentBefore = transport.sent.length;
    transport.deliver({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 77, reason: 'stale' } });
    transport.deliver({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'never' } });
    await new Promise<void>((done) => setTimeout(done, 20));
    assert.equal(transport.sent.length, sentBefore, 'nothing is sent for a cancel that matches no request');
    assert.deepEqual(resultOf(await transport.request(10, 'ping')), {});
    server.close();
  });

  it('an exclusive call cancelled while it waits in the queue never starts and gets no response', async () => {
    const { transport, server, records } = await initialized();
    transport.deliver({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'slow', arguments: { ms: 60 } } });
    transport.deliver({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow', arguments: { ms: 60 } } });
    await until(() => records.length === 1);
    transport.deliver({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2, reason: 'user' } });
    transport.deliver({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'slow', arguments: { ms: 10 } } });
    await Promise.all([transport.response(1), transport.response(3)]);
    await new Promise<void>((done) => setTimeout(done, 20));
    assert.deepEqual(records.map((r) => r.tool), ['slow', 'slow'], 'the cancelled call never started; the first and the third ran');
    assert.equal(records[0]?.aborted, false);
    assert.equal(transport.sent.some((m) => isResponse(m) && m.id === 2), false, 'the cancelled request gets no response');
    server.close();
  });

  it('runs exclusive tools one after another while a non-exclusive tool runs alongside', async () => {
    const { transport, server, records } = await initialized();
    transport.deliver({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'slow', arguments: { ms: 80 } } });
    transport.deliver({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow', arguments: { ms: 80 } } });
    transport.deliver({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { waitMs: 20 } } });
    await Promise.all([transport.response(1), transport.response(2), transport.response(3)]);
    const [first, second, third] = [records.find((r) => r.tool === 'slow'), records.filter((r) => r.tool === 'slow')[1], records.find((r) => r.tool === 'echo')];
    assert.ok(first !== undefined && second !== undefined && third !== undefined);
    assert.ok(second.start >= first.end, 'the second exclusive call started after the first ended');
    assert.ok(third.end < first.end, 'the echo finished while the first exclusive call was still running');
    assert.ok(third.start < first.end);
    server.close();
  });

  it('lists and reads a resource, and refuses an unknown uri', async () => {
    const { transport, server } = await initialized();
    assert.deepEqual(resultOf(await transport.request(1, 'resources/list')), { resources: [
      { uri: 'vision-forge://references/test.md', name: 'test', description: 'A test page.', mimeType: 'text/markdown' },
      { uri: 'vision-forge://references/broken.md', name: 'broken', mimeType: 'text/markdown' },
    ] });
    assert.deepEqual(resultOf(await transport.request(2, 'resources/read', { uri: 'vision-forge://references/test.md' })), { contents: [{ uri: 'vision-forge://references/test.md', mimeType: 'text/markdown', text: '# hello' }] });
    const missing = await transport.request(3, 'resources/read', { uri: 'vision-forge://nope' });
    assert.equal(missing.error?.code, -32602);
    server.close();
  });

  it('a handler that throws something other than a protocol error is answered with -32603 and the hook sees the error', async () => {
    const { transport, server, unexpected } = await initialized();
    const response = await transport.request(3, 'resources/read', { uri: 'vision-forge://references/broken.md' });
    assert.equal(response.result, undefined);
    assert.deepEqual(response.error, { code: -32603, message: 'disk gone' });
    assert.equal(unexpected.length, 1);
    assert.equal((unexpected[0] as Error).message, 'disk gone');
    assert.deepEqual(resultOf(await transport.request(4, 'ping')), {}, 'the server keeps serving');
    server.close();
  });

  it('lists and expands a prompt, and names a missing required argument', async () => {
    const { transport, server } = await initialized();
    const list = resultOf(await transport.request(1, 'prompts/list'));
    assert.deepEqual(list, { prompts: [{ name: 'cinematic-studio', description: 'Directs a production.', arguments: [{ name: 'brief', description: 'The brief.', required: true }] }] });
    const got = resultOf(await transport.request(2, 'prompts/get', { name: 'cinematic-studio', arguments: { brief: 'A bottle.' } }));
    assert.deepEqual(got, { description: 'Directs a production.', messages: [{ role: 'user', content: { type: 'text', text: 'Brief: A bottle.' } }] });
    const missing = await transport.request(3, 'prompts/get', { name: 'cinematic-studio' });
    assert.equal(missing.error?.code, -32602);
    assert.match(missing.error?.message ?? '', /"arguments\.brief"/);
    server.close();
  });

  it('closing the transport aborts in-flight calls and start resolves once they settle', async () => {
    const { transport, server, records, started } = await initialized();
    transport.deliver({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'slow', arguments: { ms: 5000 } } });
    await until(() => records.length === 1);
    server.close();
    await started;
    assert.equal(records[0]?.aborted, true);
    assert.equal(transport.sent.some((m) => isResponse(m) && m.id === 1), false);
  });
});
