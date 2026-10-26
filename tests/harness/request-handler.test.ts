import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DataFileError } from '../../src/errors/vision-forge-error.ts';
import { handleRequest, internalErrorText, readServeConfig, sendText } from '../../src/harness/request-handler.ts';
import type { ServeConfig } from '../../src/harness/request-handler.ts';
import type { ServedRoot } from '../../src/harness/static-roots.ts';
import { getWithHost } from './http-client.ts';

const site: ServedRoot = { urlPrefix: '/site/', directory: join(tmpdir(), 'vf-request-handler-site') };

/** A stand-in for the stripper: upper-cases the source, or throws when it contains "throw". */
function fakeStrip(source: string): string {
  if (source.includes('throw')) throw new Error('fake stripper refused the file');
  return source.toUpperCase();
}

function configError(part: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof DataFileError && error.message.includes(part);
}

describe('readServeConfig', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-serve-config-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  function writeConfig(name: string, value: unknown): string {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value), 'utf8');
    return path;
  }

  it('reads roots and an optional port', () => {
    const config: ServeConfig = { roots: [site], port: 0 };
    assert.deepEqual(readServeConfig(writeConfig('ok.json', config)), config);
    assert.deepEqual(readServeConfig(writeConfig('no-port.json', { roots: [site] })), { roots: [site] });
  });

  it('refuses a config that is not an object with a non-empty roots array', () => {
    assert.throws(() => readServeConfig(writeConfig('array.json', [])), configError('not a JSON object'));
    assert.throws(() => readServeConfig(writeConfig('empty.json', { roots: [] })), configError('"roots"'));
  });

  it('names the root entry that is malformed', () => {
    assert.throws(() => readServeConfig(writeConfig('prefix.json', { roots: [{ urlPrefix: 'site', directory: site.directory }] })), configError('roots[0].urlPrefix'));
    assert.throws(() => readServeConfig(writeConfig('dir.json', { roots: [site, { urlPrefix: '/x/', directory: 'relative' }] })), configError('roots[1].directory'));
  });

  it('refuses a port outside 0 to 65535', () => {
    assert.throws(() => readServeConfig(writeConfig('port.json', { roots: [site], port: 70000 })), configError('"port"'));
  });
});

describe('handleRequest in-process with a fake stripper', () => {
  let server: Server | undefined;
  let base = '';

  before(async () => {
    mkdirSync(site.directory, { recursive: true });
    writeFileSync(join(site.directory, 'ok.ts'), 'const a: number = 1;', 'utf8');
    writeFileSync(join(site.directory, 'bad.ts'), 'throw 1', 'utf8');
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      try {
        handleRequest([site], fakeStrip, request, response);
      } catch {
        sendText(response, 500, internalErrorText);
      }
    });
    await new Promise<void>((done) => { server?.listen(0, '127.0.0.1', done); });
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server?.closeAllConnections();
    await new Promise<void>((done) => { server?.close(() => done()); });
    rmSync(site.directory, { recursive: true, force: true });
  });

  it('passes .ts files through the strip function it is given', async () => {
    const response = await fetch(`${base}/site/ok.ts`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'CONST A: NUMBER = 1;');
  });

  it('lets a strip failure reach the caller, which answers with the fixed 500 text', async () => {
    const response = await fetch(`${base}/site/bad.ts`);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), internalErrorText);
  });

  it('accepts loopback Host headers with or without a port and refuses others', async () => {
    for (const host of ['127.0.0.1', 'localhost', 'localhost:8080', `127.0.0.1:${new URL(base).port}`]) {
      assert.equal((await getWithHost(base, '/site/ok.ts', host)).status, 200, host);
    }
    for (const host of ['evil.example', 'evil.example:80', '127.0.0.1.evil.example', 'localhost.evil', '[::1]:80']) {
      const response = await getWithHost(base, '/site/ok.ts', host);
      assert.equal(response.status, 400, host);
      assert.equal(response.body, 'bad request', host);
    }
  });
});
