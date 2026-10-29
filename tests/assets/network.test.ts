import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findCatalogueEntry } from '../../src/assets/catalogue.ts';
import { assetPath, createAssetDownloader, fetchAsset, verifyAsset } from '../../src/assets/fetch.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { AssetLedger, assetLedgerPath } from '../../src/net/asset-ledger.ts';

/** Real downloads run only on request: VF_NETWORK_TESTS=1. */
const skip = process.env['VF_NETWORK_TESTS'] === '1' ? false : 'VF_NETWORK_TESTS is not 1';
const never = new AbortController().signal;

describe('fetching from Poly Haven', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-network-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('downloads hdri:studio_small_09-1k with the pinned size and md5, records it and verifies it', { skip, timeout: 300_000 }, async () => {
    const entry = findCatalogueEntry('hdri:studio_small_09-1k');
    assert.ok(entry !== undefined);
    const log = new MemoryLogger();
    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    ledger.load();
    const started = Date.now();
    const result = await fetchAsset({ entry, dataDir, downloader: createAssetDownloader(log), ledger, log }, never);
    const seconds = (Date.now() - started) / 1000;
    assert.equal(result.downloaded, true);
    assert.equal(result.record.bytes, entry.bytes);
    assert.equal(createHash('md5').update(readFileSync(assetPath(dataDir, entry))).digest('hex'), entry.md5);
    assert.equal(result.record.md5, entry.md5);
    assert.match(result.record.sha256, /^[0-9a-f]{64}$/);
    assert.equal((await verifyAsset(entry, dataDir, ledger)).ok, true);
    // Printed so a run with VF_NETWORK_TESTS=1 leaves the numbers in the test output.
    console.log(`network: ${entry.id} ${result.record.bytes} bytes sha256 ${result.record.sha256} from ${result.record.finalUrl} in ${seconds.toFixed(1)} s`);
  });
});
