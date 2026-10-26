import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { CancelledError, DownloadIntegrityError, NetworkNotAllowedError, VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import type { AllowedHost } from '../../src/net/allowlist.ts';
import { HttpDownloader, partialPath } from '../../src/net/http-downloader.ts';
import type { DownloadRequest } from '../../src/net/http-downloader.ts';
import { LoopbackServer } from '../fakes/loopback-server.ts';

const loopbackAllowlist: readonly AllowedHost[] = [
  { host: '127.0.0.1', redirectHosts: ['localhost'], purpose: 'tests' },
  { host: 'localhost', redirectHosts: [], purpose: 'tests' },
];
const ipOnlyAllowlist: readonly AllowedHost[] = [{ host: '127.0.0.1', redirectHosts: [], purpose: 'tests' }];
const ipWithAliasAllowlist: readonly AllowedHost[] = [{ host: '127.0.0.1', redirectHosts: ['localhost'], purpose: 'tests' }];
const userAgent = 'vision-forge-test/0.0.0';
const never = new AbortController().signal;
const fixedNow = new Date('2026-10-26T12:00:00Z');
/** Root ignores file modes, so the read-only partial test cannot prove anything there. */
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** Repeatable pseudo-random bytes (xorshift32), so hashes in assertions are stable. */
function deterministicBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out[index] = state & 0xff;
  }
  return out;
}

function digest(algorithm: 'sha256' | 'md5', bytes: Buffer): string {
  return createHash(algorithm).update(bytes).digest('hex');
}

/** Matches a VisionForgeError by code and, optionally, by message and hint patterns. */
function isCode(code: string, pattern?: RegExp, hint?: RegExp): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof VisionForgeError && error.code === code
    && (pattern === undefined || pattern.test(error.message)) && (hint === undefined || hint.test(error.hint));
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.');
    await new Promise<void>((done) => setTimeout(done, 20));
  }
}

/** Writes a partial file for a request, creating its directory. */
function writePartial(request: DownloadRequest, bytes: Buffer): string {
  mkdirSync(dirname(request.destination), { recursive: true });
  writeFileSync(partialPath(request.destination), bytes);
  return partialPath(request.destination);
}

describe('HttpDownloader', () => {
  const server = new LoopbackServer();
  const small = deterministicBytes(64 * 1024, 7);
  const big = deterministicBytes(512 * 1024, 11);
  let dir = '';

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-dl-'));
    server.serveFile('/small.bin', small);
    server.serveFile('/big.bin', big, { dropAfter: 150_000 });
    server.serveFile('/ignores-range.bin', small, { rangeMode: 'ignore' });
    server.serveFile('/held.bin', big, { holdAfter: 100_000 });
    server.serveFile('/secret.bin', small);
    server.redirect('/start', '/middle');
    server.redirect('/middle', '/small.bin', 307);
    server.redirect('/signed', '/small.bin?sig=abc&jwt=def');
    server.redirect('/loop', '/loop');
    server.answer('/broken', 500, 'boom');
    server.hang('/stall');
    await server.start();
    server.redirect('/alias', server.urlFor('/small.bin', 'localhost'));
    server.redirect('/escape', server.urlFor('/secret.bin', 'localhost'));
  });

  after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  function make(allowlist: readonly AllowedHost[] = loopbackAllowlist, extra: { readonly maxHops?: number; readonly idleTimeoutMs?: number } = {}): { readonly downloader: HttpDownloader; readonly log: MemoryLogger } {
    const log = new MemoryLogger();
    const downloader = new HttpDownloader({ allowlist, userAgent, log, now: () => fixedNow, ...extra });
    return { downloader, log };
  }

  function smallRequest(name: string): DownloadRequest {
    return { url: server.urlFor('/small.bin'), destination: join(dir, name, 'small.bin'), expectedBytes: small.length, sha256: digest('sha256', small), label: name };
  }

  function bigRequest(name: string, path: string): DownloadRequest {
    return { url: server.urlFor(path), destination: join(dir, name, 'big.bin'), expectedBytes: big.length, sha256: digest('sha256', big), label: name };
  }

  it('downloads a file, verifies size, sha256 and md5, and renames it into place', async () => {
    const request = { ...smallRequest('happy'), md5: digest('md5', small) };
    const { downloader, log } = make();
    const result = await downloader.download(request, never);
    assert.equal(result.url, request.url);
    assert.equal(result.finalUrl, request.url);
    assert.deepEqual(result.hops, [{ url: request.url, status: 200 }]);
    assert.equal(result.bytes, small.length);
    assert.equal(result.sha256, digest('sha256', small));
    assert.equal(result.md5, digest('md5', small));
    assert.equal(result.resumedFrom, 0);
    assert.equal(result.fetchedAt, '2026-10-26T12:00:00.000Z');
    assert.ok(readFileSync(request.destination).equals(small));
    assert.equal(existsSync(partialPath(request.destination)), false);
    const seen = server.requests.at(-1);
    assert.equal(seen?.userAgent, userAgent);
    assert.equal(seen?.range, undefined);
    assert.ok(log.messages.some((message) => message.startsWith(`debug: happy: 200 ${request.url}`)));
  });

  it('leaves md5 out of the result when the request did not ask for it', async () => {
    const result = await make().downloader.download(smallRequest('no-md5'), never);
    assert.equal('md5' in result, false);
  });

  it('resumes after an interrupted connection with a Range request and verifies the whole file', async () => {
    const request = bigRequest('resume', '/big.bin');
    const { downloader } = make();
    await assert.rejects(downloader.download(request, never), isCode('download-interrupted', undefined, /resumes/));
    const partialBytes = statSync(partialPath(request.destination)).size;
    assert.ok(partialBytes > 0 && partialBytes <= 150_000, `the partial has ${partialBytes} bytes`);
    assert.ok(readFileSync(partialPath(request.destination)).equals(big.subarray(0, partialBytes)), 'the partial is a prefix of the file');
    const result = await downloader.download(request, never);
    assert.equal(server.requests.at(-1)?.range, `bytes=${partialBytes}-`);
    assert.equal(result.resumedFrom, partialBytes);
    assert.ok(result.resumedFrom > 0);
    assert.equal(result.bytes, big.length);
    assert.equal(result.sha256, digest('sha256', big));
    assert.ok(readFileSync(request.destination).equals(big));
    assert.equal(existsSync(partialPath(request.destination)), false);
  });

  it('starts over when the server ignores the Range header', async () => {
    const request: DownloadRequest = { url: server.urlFor('/ignores-range.bin'), destination: join(dir, 'ignored', 'small.bin'), sha256: digest('sha256', small), label: 'ignored' };
    writePartial(request, deterministicBytes(1000, 3));
    const { downloader, log } = make();
    const result = await downloader.download(request, never);
    assert.equal(server.requests.at(-1)?.range, 'bytes=1000-');
    assert.equal(result.resumedFrom, 0);
    assert.ok(readFileSync(request.destination).equals(small));
    assert.ok(log.messages.some((message) => /ignored the Range header/.test(message)));
  });

  it('discards an empty partial, or one longer than the expected file, and downloads from the beginning', async () => {
    const empty = smallRequest('empty-partial');
    writePartial(empty, Buffer.alloc(0));
    const emptyResult = await make().downloader.download(empty, never);
    assert.equal(server.requests.at(-1)?.range, undefined);
    assert.equal(emptyResult.resumedFrom, 0);
    assert.ok(readFileSync(empty.destination).equals(small));
    const long = smallRequest('long-partial');
    writePartial(long, deterministicBytes(small.length + 1, 5));
    const longResult = await make().downloader.download(long, never);
    assert.equal(server.requests.at(-1)?.range, undefined);
    assert.equal(longResult.resumedFrom, 0);
    assert.ok(readFileSync(long.destination).equals(small));
    assert.equal(existsSync(partialPath(long.destination)), false);
  });

  it('salvages a complete partial without a request', async () => {
    const request = smallRequest('salvage');
    writePartial(request, small);
    const requestsBefore = server.requests.length;
    const { downloader, log } = make();
    const result = await downloader.download(request, never);
    assert.equal(server.requests.length, requestsBefore);
    assert.deepEqual(result.hops, []);
    assert.equal(result.finalUrl, request.url);
    assert.equal(result.resumedFrom, small.length);
    assert.equal(result.bytes, small.length);
    assert.equal(result.sha256, digest('sha256', small));
    assert.ok(readFileSync(request.destination).equals(small));
    assert.equal(existsSync(partialPath(request.destination)), false);
    assert.ok(log.messages.some((message) => /complete partial/.test(message)));
  });

  it('removes a complete partial that fails verification, then downloads it fresh', async () => {
    const request = smallRequest('salvage-bad');
    writePartial(request, deterministicBytes(small.length, 9));
    const { downloader } = make();
    await assert.rejects(downloader.download(request, never), (error: unknown) => error instanceof DownloadIntegrityError && /wrong sha256/.test(error.message));
    assert.equal(existsSync(partialPath(request.destination)), false);
    const result = await downloader.download(request, never);
    assert.equal(result.resumedFrom, 0);
    assert.ok(readFileSync(request.destination).equals(small));
  });

  it('removes the partial and fails with the removed hint when the server answers 416', async () => {
    const request: DownloadRequest = { url: server.urlFor('/small.bin'), destination: join(dir, 'past-end', 'small.bin'), sha256: digest('sha256', small), label: 'past-end' };
    writePartial(request, deterministicBytes(small.length + 10, 5));
    await assert.rejects(make().downloader.download(request, never), isCode('download-failed', /longer than the file/, /removed/));
    assert.equal(server.requests.at(-1)?.range, `bytes=${small.length + 10}-`);
    assert.equal(existsSync(partialPath(request.destination)), false);
    assert.equal(existsSync(request.destination), false);
  });

  it('deletes the partial and throws DownloadIntegrityError on a sha256 mismatch', async () => {
    const request = { ...smallRequest('bad-sha'), sha256: 'ab'.repeat(32) };
    await assert.rejects(make().downloader.download(request, never), (error: unknown) => error instanceof DownloadIntegrityError && /wrong sha256/.test(error.message));
    assert.equal(existsSync(partialPath(request.destination)), false);
    assert.equal(existsSync(request.destination), false);
  });

  it('throws DownloadIntegrityError on a size or md5 mismatch', async () => {
    const wrongSize = { ...smallRequest('bad-size'), expectedBytes: small.length + 1 };
    await assert.rejects(make().downloader.download(wrongSize, never), (error: unknown) => error instanceof DownloadIntegrityError && /wrong size/.test(error.message));
    const wrongMd5 = { ...smallRequest('bad-md5'), md5: 'cd'.repeat(16) };
    await assert.rejects(make().downloader.download(wrongMd5, never), (error: unknown) => error instanceof DownloadIntegrityError && /wrong md5/.test(error.message));
    assert.equal(existsSync(partialPath(wrongMd5.destination)), false);
  });

  it('rejects a declared size that differs from expectedBytes before reading the body', async () => {
    // /held.bin never finishes, so this test only passes when the size check happens on the headers.
    const request = { ...bigRequest('early-size', '/held.bin'), expectedBytes: big.length - 1 };
    await assert.rejects(make().downloader.download(request, never), (error: unknown) => error instanceof DownloadIntegrityError
      && /wrong size/.test(error.message) && error.expected === String(big.length - 1) && error.actual === String(big.length));
    assert.equal(existsSync(partialPath(request.destination)), false);
    assert.equal(existsSync(request.destination), false);
  });

  it('follows redirects, records every hop and logs them', async () => {
    const request = { ...smallRequest('chain'), url: server.urlFor('/start') };
    const { downloader, log } = make();
    const result = await downloader.download(request, never);
    assert.deepEqual(result.hops.map((hop) => hop.status), [302, 307, 200]);
    assert.equal(result.hops[0]?.url, server.urlFor('/start'));
    assert.equal(result.finalUrl, server.urlFor('/small.bin'));
    assert.equal(result.sha256, digest('sha256', small));
    assert.equal(log.messages.filter((message) => /^debug: chain: (302|307|200) /.test(message)).length, 3);
  });

  it('requests the full URL but records hops and the final URL without their query string', async () => {
    const request = { ...smallRequest('signed'), url: server.urlFor('/signed') };
    const { downloader, log } = make();
    const result = await downloader.download(request, never);
    assert.equal(server.requests.at(-1)?.path, '/small.bin?sig=abc&jwt=def');
    assert.equal(result.finalUrl, server.urlFor('/small.bin'));
    assert.deepEqual(result.hops.map((hop) => hop.url), [server.urlFor('/signed'), server.urlFor('/small.bin')]);
    assert.equal(log.messages.some((message) => message.includes('sig=')), false);
  });

  it('follows a redirect to a host the origin lists, but refuses that host as a start', async () => {
    const { downloader } = make(ipWithAliasAllowlist);
    const result = await downloader.download({ ...smallRequest('alias'), url: server.urlFor('/alias') }, never);
    assert.equal(result.finalUrl, server.urlFor('/small.bin', 'localhost'));
    assert.equal(result.hops.length, 2);
    await assert.rejects(downloader.download({ ...smallRequest('alias-direct'), url: server.urlFor('/small.bin', 'localhost') }, never), NetworkNotAllowedError);
  });

  it('refuses a redirect to a host outside the allowlist before contacting it', async () => {
    const request = { ...smallRequest('escape'), url: server.urlFor('/escape') };
    await assert.rejects(make(ipOnlyAllowlist).downloader.download(request, never), (error: unknown) => error instanceof NetworkNotAllowedError && error.host === 'localhost');
    assert.equal(server.requests.some((seen) => seen.path === '/secret.bin'), false);
    assert.equal(existsSync(partialPath(request.destination)), false);
    assert.equal(existsSync(request.destination), false);
  });

  it('stops after maxHops requests in a redirect loop', async () => {
    const seenBefore = server.requests.filter((seen) => seen.path === '/loop').length;
    const request: DownloadRequest = { url: server.urlFor('/loop'), destination: join(dir, 'loop.bin'), sha256: digest('sha256', small), label: 'loop' };
    await assert.rejects(make(loopbackAllowlist, { maxHops: 3 }).downloader.download(request, never), isCode('download-failed', /redirects/));
    assert.equal(server.requests.filter((seen) => seen.path === '/loop').length - seenBefore, 3);
  });

  it('reports a failing status with its number and keeps no partial', async () => {
    const broken: DownloadRequest = { url: server.urlFor('/broken'), destination: join(dir, 'broken.bin'), sha256: digest('sha256', small), label: 'broken' };
    await assert.rejects(make().downloader.download(broken, never), isCode('download-failed', /answered 500/));
    const missing: DownloadRequest = { url: server.urlFor('/missing'), destination: join(dir, 'missing.bin'), sha256: digest('sha256', small), label: 'missing' };
    await assert.rejects(make().downloader.download(missing, never), isCode('download-failed', /answered 404/, /pin/));
    assert.equal(existsSync(partialPath(broken.destination)), false);
  });

  it('fails with a network hint when no response arrives within the idle time', async () => {
    const request: DownloadRequest = { url: server.urlFor('/stall'), destination: join(dir, 'stall', 'small.bin'), sha256: digest('sha256', small), label: 'stall' };
    const { downloader } = make(loopbackAllowlist, { idleTimeoutMs: 200 });
    await assert.rejects(downloader.download(request, never), isCode('download-failed', /no response within 0\.2 s/, /network/));
    assert.equal(existsSync(partialPath(request.destination)), false);
  });

  it('keeps the partial and reports an interruption when the body stalls for the idle time', async () => {
    const request = bigRequest('stalled', '/held.bin');
    const { downloader } = make(loopbackAllowlist, { idleTimeoutMs: 500 });
    await assert.rejects(downloader.download(request, never), isCode('download-interrupted', /no data for 0\.5 s/, /resumes/));
    assert.equal(statSync(partialPath(request.destination)).size, 100_000);
    assert.equal(existsSync(request.destination), false);
  });

  it('reports a write failure as download-failed with a disk hint, not as an interruption', { skip: isRoot }, async () => {
    const request = smallRequest('read-only');
    const partial = writePartial(request, small.subarray(0, 1000));
    chmodSync(partial, 0o444);
    try {
      await assert.rejects(make().downloader.download(request, never), isCode('download-failed', /could not write/, /free space and permissions/));
      assert.equal(server.requests.at(-1)?.range, 'bytes=1000-');
      assert.equal(existsSync(request.destination), false);
    } finally {
      chmodSync(partial, 0o644);
    }
  });

  it('keeps the partial for resume and rejects with CancelledError when aborted', async () => {
    const request = bigRequest('abort', '/held.bin');
    const partial = partialPath(request.destination);
    const controller = new AbortController();
    const pending = make().downloader.download(request, controller.signal);
    await waitFor(() => existsSync(partial) && statSync(partial).size >= 100_000);
    controller.abort();
    await assert.rejects(pending, CancelledError);
    assert.ok(statSync(partial).size >= 100_000);
    assert.equal(existsSync(request.destination), false);
  });

  it('rejects at once when the signal is already aborted, without a request', async () => {
    const controller = new AbortController();
    controller.abort();
    const requestsBefore = server.requests.length;
    await assert.rejects(make().downloader.download(smallRequest('never'), controller.signal), CancelledError);
    assert.equal(server.requests.length, requestsBefore);
  });
});
