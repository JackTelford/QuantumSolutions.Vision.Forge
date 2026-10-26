import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { HarnessServer, HarnessServerError } from '../../src/harness/harness-server.ts';
import { threeVendorRoot } from '../../src/harness/static-roots.ts';
import type { ServedRoot } from '../../src/harness/static-roots.ts';
import { getWithHost } from './http-client.ts';

const mainSource = [
  "import { double } from './x.ts';",
  "import type { Pair } from './x.ts';",
  'export const answer: number = double(21);',
  'export function pair(a: number, b: number): Pair { return [a, b]; }',
  '',
].join('\n');
const xSource = 'export type Pair = readonly [number, number];\nexport function double(value: number): number { return value * 2; }\n';
const enumSource = 'export enum Color { Red }\n';
const secret = 'TOP-SECRET-MARKER';
const binaryBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
const never = new AbortController().signal;

function threeRootIfInstalled(): ServedRoot | undefined {
  try {
    return threeVendorRoot();
  } catch {
    return undefined;
  }
}

function harnessTempEntries(): readonly string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('vf-harness-')).sort();
}

async function waitUntil(condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise<void>((done) => setTimeout(done, 50));
  }
  return condition();
}

async function portRefuses(url: string): Promise<boolean> {
  try {
    await (await fetch(url)).arrayBuffer();
    return false;
  } catch {
    return true;
  }
}

function harnessError(...patterns: readonly RegExp[]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof HarnessServerError && patterns.every((pattern) => pattern.test(error.message));
}

describe('HarnessServer', () => {
  let dir = '';
  let base = '';
  let roots: ServedRoot[] = [];
  let server: HarnessServer | undefined;
  const log = new MemoryLogger();
  const threeRoot = threeRootIfInstalled();

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-site-'));
    const siteDir = join(dir, 'site');
    mkdirSync(join(siteDir, 'app'), { recursive: true });
    mkdirSync(join(siteDir, 'nested', 'deep'), { recursive: true });
    writeFileSync(join(siteDir, 'app', 'main.ts'), mainSource, 'utf8');
    writeFileSync(join(siteDir, 'app', 'x.ts'), xSource, 'utf8');
    writeFileSync(join(siteDir, 'app', 'enum.ts'), enumSource, 'utf8');
    writeFileSync(join(siteDir, 'index.html'), '<!doctype html><title>harness</title>', 'utf8');
    writeFileSync(join(siteDir, 'nested', 'deep', 'style.css'), 'body { margin: 0; }', 'utf8');
    writeFileSync(join(siteDir, 'blob.png'), binaryBytes);
    writeFileSync(join(dir, 'secret.txt'), secret, 'utf8');
    roots = [{ urlPrefix: '/site/', directory: siteDir }];
    if (threeRoot !== undefined) roots.push(threeRoot);
    server = new HarnessServer({ roots, log });
    await server.start(never);
    base = server.url;
  });

  after(async () => {
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a loopback URL once started', () => {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('serves a .ts file stripped to JavaScript and keeps the .ts specifier', async () => {
    const response = await fetch(`${base}/site/app/main.ts`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!body.includes(': number'), body);
    assert.ok(!body.includes('import type'), body);
    assert.ok(body.includes("from './x.ts'"), body);
    assert.ok(body.includes('double(21)'), body);
  });

  it('serves html with its content type and the same headers', async () => {
    const response = await fetch(`${base}/site/index.html`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), '<!doctype html><title>harness</title>');
  });

  it('serves a nested file', async () => {
    const response = await fetch(`${base}/site/nested/deep/style.css`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(await response.text(), 'body { margin: 0; }');
  });

  it('serves a binary file byte for byte', async () => {
    const response = await fetch(`${base}/site/blob.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('content-length'), '256');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binaryBytes);
  });

  it('answers HEAD with the headers of GET, the exact body length and no body', async () => {
    for (const path of ['/site/app/main.ts', '/site/blob.png']) {
      const get = await fetch(`${base}${path}`);
      const body = new Uint8Array(await get.arrayBuffer());
      const head = await fetch(`${base}${path}`, { method: 'HEAD' });
      assert.equal(head.status, 200, path);
      assert.equal(head.headers.get('content-type'), get.headers.get('content-type'), path);
      assert.equal(head.headers.get('content-length'), String(body.byteLength), path);
      assert.equal(await head.text(), '', path);
    }
  });

  it('answers 500 for a file the stripper rejects, without the cause, and keeps serving', async () => {
    const response = await fetch(`${base}/site/app/enum.ts`);
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(body, 'internal error');
    const again = await fetch(`${base}/site/app/main.ts`);
    await again.text();
    assert.equal(again.status, 200);
    const logged = await waitUntil(() => Promise.resolve(log.messages.some((m) => m.startsWith('debug: harness: error serving /site/app/enum.ts: '))), 2_000);
    assert.ok(logged, log.messages.join('\n'));
  });

  it('refuses a path that escapes its root with 404 and never serves the secret', async () => {
    const paths = ['/site/..%2F..%2Fsecret.txt', '/site/..%2Fsecret.txt', '/site/..%5Csecret.txt', '/site/app%5C..%5C..%5Csecret.txt', '/site/%2e%2e%5Csecret.txt'];
    for (const path of paths) {
      const response = await fetch(`${base}${path}`);
      const body = await response.text();
      assert.equal(response.status, 404, path);
      assert.ok(!body.includes(secret), path);
    }
  });

  it('answers 404 for an unknown root, a directory and a missing file', async () => {
    for (const path of ['/secret.txt', '/elsewhere/index.html', '/site/', '/site/nested', '/site/missing.ts']) {
      const response = await fetch(`${base}${path}`);
      await response.text();
      assert.equal(response.status, 404, path);
    }
  });

  it('answers the favicon with 204 and no body', async () => {
    const response = await fetch(`${base}/favicon.ico`);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });

  it('refuses methods other than GET and HEAD with 405', async () => {
    const response = await fetch(`${base}/site/index.html`, { method: 'POST', body: 'ignored' });
    await response.text();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  });

  it('refuses a Host header that is not loopback with 400', async () => {
    const response = await getWithHost(base, '/site/index.html', 'evil.example');
    assert.equal(response.status, 400);
    assert.equal(response.body, 'bad request');
    assert.equal((await getWithHost(base, '/site/index.html', 'localhost')).status, 200);
  });

  it('serves the installed three package under /vendor/three/', async (context) => {
    if (threeRoot === undefined) {
      context.skip('node_modules/three is not installed');
      return;
    }
    const response = await fetch(`${base}/vendor/three/package.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    const pkg = JSON.parse(await response.text()) as { readonly name?: string };
    assert.equal(pkg.name, 'three');
  });

  it('forwards the child standard error lines to the debug log', async () => {
    await (await fetch(`${base}/site/app/x.ts`)).text();
    const seen = await waitUntil(() => Promise.resolve(log.messages.some((m) => m === 'debug: harness: GET /site/app/x.ts 200')), 2_000);
    assert.ok(seen, log.messages.join('\n'));
  });

  it('throws from url before start', () => {
    const fresh = new HarnessServer({ roots, log: new MemoryLogger() });
    assert.throws(() => fresh.url, HarnessServerError);
  });

  it('stops the child so the port stops answering, and removes its config', async () => {
    const entriesBefore = harnessTempEntries();
    const fresh = new HarnessServer({ roots, log: new MemoryLogger() });
    await fresh.start(never);
    // Other test files may start their own servers in parallel, so only this server's entries are tracked.
    const created = harnessTempEntries().filter((entry) => !entriesBefore.includes(entry));
    assert.ok(created.length >= 1);
    const freshUrl = fresh.url;
    assert.equal((await fetch(`${freshUrl}/site/index.html`)).status, 200);
    await fresh.stop();
    assert.ok(await portRefuses(`${freshUrl}/site/index.html`));
    const remaining = harnessTempEntries();
    assert.ok(created.some((entry) => !remaining.includes(entry)), created.join(', '));
    assert.throws(() => fresh.url, HarnessServerError);
    await fresh.stop();
  });

  it('returns the in-flight promise from a second stop() and resolves both once the port is closed', async () => {
    const fresh = new HarnessServer({ roots, log: new MemoryLogger() });
    await fresh.start(never);
    const freshUrl = fresh.url;
    const first = fresh.stop();
    const second = fresh.stop();
    assert.equal(second, first);
    await second;
    assert.ok(await portRefuses(`${freshUrl}/site/index.html`));
  });

  it('stops when the start signal aborts', async () => {
    const controller = new AbortController();
    const fresh = new HarnessServer({ roots, log: new MemoryLogger() });
    await fresh.start(controller.signal);
    const freshUrl = fresh.url;
    controller.abort();
    assert.ok(await waitUntil(() => portRefuses(`${freshUrl}/site/index.html`), 5_000));
    assert.throws(() => fresh.url, HarnessServerError);
  });

  it('rejects roots and ports that cannot be served before spawning anything', () => {
    const missing = join(dir, 'missing');
    assert.throws(() => new HarnessServer({ roots: [{ urlPrefix: 'no-leading-slash', directory: dir }], log }), harnessError(/roots\[0\]\.urlPrefix/, /no-leading-slash/));
    assert.throws(() => new HarnessServer({ roots: [roots[0] ?? { urlPrefix: '/', directory: dir }, { urlPrefix: '/x/', directory: missing }], log }), harnessError(/roots\[1\]\.directory/, /missing/));
    assert.throws(() => new HarnessServer({ roots, log, port: 70000 }), harnessError(/70000/));
    assert.throws(() => new HarnessServer({ roots, log, port: 1.5 }), harnessError(/1\.5/));
  });

  it('rejects start when the fixed port is in use, naming the port and the way out', async () => {
    const port = Number(new URL(base).port);
    const fresh = new HarnessServer({ roots, log: new MemoryLogger(), port });
    await assert.rejects(fresh.start(never), harnessError(/before reporting its port/, /EADDRINUSE/, new RegExp(`Port ${port} is in use\\. Pass port 0`)));
    assert.throws(() => fresh.url, HarnessServerError);
    assert.equal((await fetch(`${base}/site/index.html`)).status, 200);
  });
});
