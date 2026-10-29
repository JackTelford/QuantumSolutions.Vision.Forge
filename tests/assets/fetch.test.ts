import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { CatalogueEntry } from '../../src/assets/catalogue.ts';
import { assetPath, corruptPath, fetchAsset, isInstalled, setAside, sha256File, verifyAsset } from '../../src/assets/fetch.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { DownloadIntegrityError, VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import type { AllowedHost } from '../../src/net/allowlist.ts';
import { AssetLedger, assetLedgerPath } from '../../src/net/asset-ledger.ts';
import { HttpDownloader } from '../../src/net/http-downloader.ts';
import { LoopbackServer } from '../fakes/loopback-server.ts';

const loopbackAllowlist: readonly AllowedHost[] = [{ host: '127.0.0.1', redirectHosts: [], purpose: 'tests' }];
const never = new AbortController().signal;
const fixedNow = new Date('2026-10-29T12:00:00Z');

/** Repeatable bytes so the hashes in assertions are stable. */
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

describe('fetchAsset and verifyAsset', () => {
  const server = new LoopbackServer();
  const body = deterministicBytes(96 * 1024, 29);
  let dir = '';
  let entry: CatalogueEntry;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-assets-'));
    server.serveFile('/x.hdr', body);
    await server.start();
    entry = {
      id: 'hdri:x-1k',
      kind: 'hdri',
      name: 'x',
      url: server.urlFor('/x.hdr'),
      bytes: body.length,
      md5: digest('md5', body),
      license: 'CC0-1.0',
      credit: 'X by Tests, Poly Haven (CC0)',
      file: 'assets/hdri/x_1k.hdr',
      kelvin: null,
      description: 'A test HDRI.',
      tags: ['test'],
    };
  });

  after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  function make(dataDir: string): { readonly downloader: HttpDownloader; readonly ledger: AssetLedger; readonly log: MemoryLogger } {
    const log = new MemoryLogger();
    const downloader = new HttpDownloader({ allowlist: loopbackAllowlist, userAgent: 'vision-forge-test/0.0.0', log, now: () => fixedNow });
    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    ledger.load();
    return { downloader, ledger, log };
  }

  it('downloads a catalogue entry into the data directory, records it and saves the ledger', async () => {
    const dataDir = join(dir, 'first');
    const { downloader, ledger, log } = make(dataDir);
    const requestsBefore = server.requests.length;
    const result = await fetchAsset({ entry, dataDir, downloader, ledger, log }, never);
    assert.equal(result.downloaded, true);
    assert.deepEqual(result.record, {
      id: 'hdri:x-1k',
      source: entry.url,
      finalUrl: entry.url,
      license: 'CC0-1.0',
      bytes: body.length,
      sha256: digest('sha256', body),
      md5: digest('md5', body),
      fetchedAt: '2026-10-29T12:00:00.000Z',
      credit: 'X by Tests, Poly Haven (CC0)',
      files: ['assets/hdri/x_1k.hdr'],
    });
    assert.ok(readFileSync(assetPath(dataDir, entry)).equals(body));
    assert.equal(existsSync(assetLedgerPath(dataDir)), true);
    assert.equal(server.requests.length - requestsBefore, 1);
    assert.ok(log.messages.includes(`info: hdri:x-1k: downloaded ${body.length} bytes from ${entry.url}`), log.messages.join('\n'));
    assert.equal(isInstalled(entry, dataDir, ledger), true);

    const reloaded = new AssetLedger(assetLedgerPath(dataDir));
    reloaded.load();
    assert.deepEqual(reloaded.find('hdri:x-1k'), result.record);
  });

  it('returns downloaded:false without touching the network when the asset is installed', async () => {
    const dataDir = join(dir, 'first');
    const { downloader, ledger, log } = make(dataDir);
    const requestsBefore = server.requests.length;
    const result = await fetchAsset({ entry, dataDir, downloader, ledger, log }, never);
    assert.equal(result.downloaded, false);
    assert.equal(result.record.sha256, digest('sha256', body));
    assert.equal(server.requests.length, requestsBefore);
    assert.ok(log.messages.some((message) => message.startsWith('info: hdri:x-1k: already installed at ')));
  });

  it('downloads again when the catalogue pin changed since the ledger record was written', async () => {
    const dataDir = join(dir, 'first');
    const { ledger } = make(dataDir);
    const repinned: CatalogueEntry = { ...entry, md5: 'f'.repeat(32) };
    assert.equal(isInstalled(repinned, dataDir, ledger), false);
    assert.equal(isInstalled(entry, dataDir, ledger), true);
  });

  it('throws DownloadIntegrityError on a wrong md5 and records nothing', async () => {
    const dataDir = join(dir, 'bad-md5');
    const { downloader, ledger, log } = make(dataDir);
    const wrong: CatalogueEntry = { ...entry, md5: '0'.repeat(32) };
    await assert.rejects(fetchAsset({ entry: wrong, dataDir, downloader, ledger, log }, never), (error: unknown) => error instanceof DownloadIntegrityError && /wrong md5/.test(error.message));
    assert.equal(ledger.find(wrong.id), undefined);
    assert.equal(existsSync(assetLedgerPath(dataDir)), false);
    assert.equal(existsSync(assetPath(dataDir, wrong)), false);
  });

  it('verifies an installed file against the ledger and detects a modified one', async () => {
    const dataDir = join(dir, 'verify');
    const { downloader, ledger, log } = make(dataDir);
    await fetchAsset({ entry, dataDir, downloader, ledger, log }, never);
    const good = await verifyAsset(entry, dataDir, ledger);
    assert.equal(good.ok, true, good.reason);
    assert.match(good.reason, /matches the ledger/);

    const path = assetPath(dataDir, entry);
    const tampered = Buffer.from(body);
    tampered[100] = (tampered[100] ?? 0) ^ 0xff;
    writeFileSync(path, tampered);
    const same = await verifyAsset(entry, dataDir, ledger);
    assert.equal(same.ok, false);
    assert.match(same.reason, new RegExp(`hashes to sha256 ${digest('sha256', tampered)}, the ledger recorded ${digest('sha256', body)}`));

    writeFileSync(path, body.subarray(0, 10));
    const short = await verifyAsset(entry, dataDir, ledger);
    assert.equal(short.ok, false);
    assert.match(short.reason, /is 10 bytes, the ledger recorded/);

    rmSync(path);
    const missing = await verifyAsset(entry, dataDir, ledger);
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /does not exist/);
    assert.equal(isInstalled(entry, dataDir, ledger), false);
  });

  it('reports an asset the ledger does not know as not verifiable', async () => {
    const dataDir = join(dir, 'unknown');
    const { ledger } = make(dataDir);
    const result = await verifyAsset(entry, dataDir, ledger);
    assert.deepEqual(result, { ok: false, reason: 'hdri:x-1k is not in the ledger' });
  });

  it('hashes a file with streaming sha256', async () => {
    const path = join(dir, 'hash.bin');
    writeFileSync(path, body);
    assert.equal(await sha256File(path), digest('sha256', body));
  });

  it('stamps fetchedAt from the caller clock when one is given, else from the downloader', async () => {
    const dataDir = join(dir, 'clock');
    const { downloader, ledger, log } = make(dataDir);
    const result = await fetchAsset({ entry, dataDir, downloader, ledger, log, now: () => new Date('2026-11-01T08:30:00Z') }, never);
    assert.equal(result.record.fetchedAt, '2026-11-01T08:30:00.000Z');
  });

  it('moves a failed file to <path>.corrupt so the asset counts as not installed, and does nothing for a missing file', async () => {
    const dataDir = join(dir, 'aside');
    const { downloader, ledger, log } = make(dataDir);
    await fetchAsset({ entry, dataDir, downloader, ledger, log }, never);
    const path = assetPath(dataDir, entry);
    assert.equal(corruptPath(path), `${path}.corrupt`);
    assert.equal(setAside(path), `${path}.corrupt`);
    assert.equal(existsSync(path), false);
    assert.ok(readFileSync(`${path}.corrupt`).equals(body));
    assert.equal(isInstalled(entry, dataDir, ledger), false, 'the next fetch downloads again');
    assert.equal(setAside(path), undefined);

    // A second failure replaces the older .corrupt file instead of failing on it.
    writeFileSync(path, body.subarray(0, 10));
    assert.equal(setAside(path), `${path}.corrupt`);
    assert.equal(readFileSync(`${path}.corrupt`).length, 10);
  });

  it('reports a file it cannot read as asset-read with a hint instead of a bare fs error', async () => {
    // A directory exists but cannot be streamed; that is the nearest repeatable stand-in for a locked or unreadable file.
    const path = join(dir, 'a-directory');
    mkdirSync(path, { recursive: true });
    await assert.rejects(sha256File(path), (error: unknown) => error instanceof VisionForgeError && error.code === 'asset-read' && error.message.startsWith(`Cannot read ${path}: `) && /assets --verify/.test(error.hint) && error.cause instanceof Error);
  });
});
