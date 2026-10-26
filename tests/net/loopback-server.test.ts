import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { LoopbackServer } from '../fakes/loopback-server.ts';

/** Reads a body to the end, or until the read fails, counting the bytes that arrived. */
async function readBody(response: Response): Promise<{ readonly bytes: number; readonly error: unknown }> {
  assert.ok(response.body !== null, 'the response has a body');
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes, error: undefined };
      bytes += value.length;
    }
  } catch (error: unknown) {
    return { bytes, error };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((done) => setTimeout(done, ms));
}

describe('LoopbackServer', () => {
  const server = new LoopbackServer();
  const body = Buffer.from('0123456789');

  before(async () => {
    server.serveFile('/f', body);
    server.serveFile('/whole', body, { rangeMode: 'ignore' });
    server.serveFile('/drop', Buffer.alloc(20_000, 1), { dropAfter: 5_000 });
    server.serveFile('/drop-twice', Buffer.alloc(20_000, 2), { dropAfter: 5_000, dropTimes: 2 });
    server.serveFile('/hold', Buffer.alloc(20_000, 3), { holdAfter: 5_000 });
    server.redirect('/r', '/f');
    server.answer('/teapot', 418, 'short and stout');
    server.hang('/stall');
    await server.start();
  });

  after(async () => { await server.stop(); });

  it('serves a byte range with 206 and Content-Range, and 416 past the end', async () => {
    const partial = await fetch(server.urlFor('/f'), { headers: { range: 'bytes=4-' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 4-9/10');
    assert.equal(partial.headers.get('content-length'), '6');
    assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), '456789');
    const beyond = await fetch(server.urlFor('/f'), { headers: { range: 'bytes=10-' } });
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get('content-range'), 'bytes */10');
    await beyond.arrayBuffer();
  });

  it('answers 200 with the whole body when told to ignore ranges', async () => {
    const response = await fetch(server.urlFor('/whole'), { headers: { range: 'bytes=4-' } });
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '0123456789');
  });

  it('redirects without following, answers fixed statuses and 404 for unknown paths', async () => {
    const redirected = await fetch(server.urlFor('/r'), { redirect: 'manual' });
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get('location'), '/f');
    await redirected.arrayBuffer();
    const teapot = await fetch(server.urlFor('/teapot'));
    assert.equal(teapot.status, 418);
    assert.equal(await teapot.text(), 'short and stout');
    const missing = await fetch(server.urlFor('/nowhere'));
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
  });

  it('logs every request with its path, host, Range and User-Agent headers', async () => {
    const response = await fetch(server.urlFor('/f', 'localhost'), { headers: { range: 'bytes=2-', 'user-agent': 'probe/1' } });
    await response.arrayBuffer();
    const seen = server.requests.at(-1);
    assert.equal(seen?.method, 'GET');
    assert.equal(seen?.path, '/f');
    assert.equal(seen?.host, `localhost:${new URL(server.url).port}`);
    assert.equal(seen?.range, 'bytes=2-');
    assert.equal(seen?.userAgent, 'probe/1');
    assert.equal(server.requests[0]?.range, 'bytes=4-');
  });

  it('closes the connection after dropAfter bytes once, then serves the whole body', async () => {
    const dropped = await readBody(await fetch(server.urlFor('/drop')));
    assert.equal(dropped.bytes, 5_000);
    assert.ok(dropped.error instanceof Error, 'the read failed');
    const whole = await readBody(await fetch(server.urlFor('/drop')));
    assert.equal(whole.bytes, 20_000);
    assert.equal(whole.error, undefined);
  });

  it('closes the connection dropTimes times before serving the whole body', async () => {
    for (const attempt of [1, 2]) {
      const dropped = await readBody(await fetch(server.urlFor('/drop-twice')));
      assert.equal(dropped.bytes, 5_000, `attempt ${attempt}`);
      assert.ok(dropped.error instanceof Error, `attempt ${attempt} failed`);
    }
    const whole = await readBody(await fetch(server.urlFor('/drop-twice')));
    assert.equal(whole.bytes, 20_000);
    assert.equal(whole.error, undefined);
  });

  it('sends holdAfter bytes, then keeps the connection open without finishing', async () => {
    const response = await fetch(server.urlFor('/hold'));
    assert.ok(response.body !== null, 'the response has a body');
    const reader = response.body.getReader();
    let bytes = 0;
    while (bytes < 5_000) {
      const { done, value } = await reader.read();
      if (done) assert.fail('the body ended early');
      bytes += value.length;
    }
    assert.equal(bytes, 5_000);
    const outcome = await Promise.race([reader.read().then((): string => 'data'), delay(150).then((): string => 'still held')]);
    assert.equal(outcome, 'still held');
    await reader.cancel();
  });

  it('logs a hung request and never answers it', async () => {
    await assert.rejects(fetch(server.urlFor('/stall'), { signal: AbortSignal.timeout(200) }), (error: unknown) => error instanceof Error && error.name === 'TimeoutError');
    assert.equal(server.requests.at(-1)?.path, '/stall');
  });
});
