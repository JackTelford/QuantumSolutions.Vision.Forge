import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { componentPaths, componentStatus } from '../../src/audio/component.ts';
import { installNarration } from '../../src/audio/install.ts';
import type { NarrationProvenance } from '../../src/audio/install.ts';
import { kokoroCommit, kokoroWeightAssetId, kokoroWeightDestination, kokoroWeightFiles } from '../../src/audio/weights.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { AssetLedger, assetLedgerPath } from '../../src/net/asset-ledger.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';

/**
 * The real install: npm ci against registry.npmjs.org (about 150 MB) and
 * the four pinned files from Hugging Face (92 MB), so it runs only when
 * VF_NARRATION_INSTALL=1. The target is VF_NARRATION_DATA_DIR when set (so
 * the synthesis integration test can reuse the install), else a fresh temp
 * directory that is left in place for inspection.
 */
const enabled = process.env['VF_NARRATION_INSTALL'] === '1';

describe('the real narration install', { skip: enabled ? false : 'set VF_NARRATION_INSTALL=1 to run the real npm ci and the 92 MB download' }, () => {
  it('installs the packages and the pinned weights into a data directory and writes the provenance', { timeout: 20 * 60_000 }, async (t) => {
    const dataDir = process.env['VF_NARRATION_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'vf-narration-real-'));
    const log = new MemoryLogger();
    const started = Date.now();
    const result = await installNarration({ dataDir, runner: new ChildProcessRunner(), log, signal: new AbortController().signal, now: () => new Date(), confirm: true });
    const elapsed = (Date.now() - started) / 1000;
    t.diagnostic(`data directory ${dataDir}`);
    t.diagnostic(`install took ${elapsed.toFixed(1)} s; npm ran: ${result.packages.installedNow}; downloaded: ${result.weights.filter((weight) => weight.downloaded).map((weight) => weight.path).join(', ') || 'nothing'}`);
    for (const message of log.messages.filter((message) => /packages: installed|downloaded \d+ bytes/.test(message))) t.diagnostic(message);

    assert.equal(result.confirmed, true);
    assert.equal(result.installed, true);
    const status = componentStatus(dataDir);
    assert.deepEqual(status.missing, []);
    for (const file of kokoroWeightFiles) {
      assert.equal(statSync(kokoroWeightDestination(dataDir, file)).size, file.bytes, file.path);
      const weight = result.weights.find((entry) => entry.path === file.path);
      assert.equal(weight?.sha256, file.sha256, file.path);
    }

    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    ledger.load();
    const model = ledger.find(kokoroWeightAssetId(kokoroWeightFiles[0]!));
    assert.ok(model !== undefined);
    assert.equal(model.license, 'Apache-2.0');
    assert.match(model.finalUrl, /^https:\/\/(huggingface\.co|[a-z0-9.-]+\.hf\.co)\//, model.finalUrl);
    t.diagnostic(`model served by ${model.finalUrl}`);

    const paths = componentPaths(dataDir);
    assert.ok(existsSync(paths.license));
    const provenance = JSON.parse(readFileSync(paths.provenance, 'utf8')) as NarrationProvenance;
    assert.equal(provenance.kind, 'narration-provenance');
    assert.equal(provenance.commit, kokoroCommit);
    assert.equal(provenance.files.length, 4);
    assert.equal(provenance.packages.count, 80);
    t.diagnostic(`provenance ${paths.provenance}: ${JSON.stringify(provenance)}`);
  });
});
