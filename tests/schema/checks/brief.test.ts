import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { AssetLedger, assetLedgerPath } from '../../../src/net/asset-ledger.ts';
import { aspectRatios, briefRules, checkBrief } from '../../../src/schema/checks/brief.ts';
import { semanticCheckCount } from '../../../src/schema/checks/index.ts';
import { AspectValues } from '../../../src/shared/contracts/brief.ts';
import { assetsLedgerExample, briefExample, mutated } from '../documents/examples.ts';

const noDataDir = { dataDir: undefined };

describe('checkBrief', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-brief-check-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('registers every rule under the brief kind', () => {
    assert.equal(semanticCheckCount('brief'), briefRules.length);
    assert.equal(briefRules.length, 5);
  });

  it('knows a ratio for every aspect token', () => {
    assert.deepEqual(Object.keys(aspectRatios).sort(), [...AspectValues].sort());
  });

  it('passes the example', () => {
    assert.deepEqual(checkBrief(briefExample, noDataDir), []);
  });

  it('reports odd dimensions', () => {
    const problems = checkBrief(mutated(briefExample, (copy) => { copy.width = 1921; }), noDataDir);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /width and height must be even .* 1921x1080/);
  });

  it('reports dimensions that do not match the aspect within 1 percent', () => {
    const problems = checkBrief(mutated(briefExample, (copy) => { copy.height = 1200; }), noDataDir);
    assert.deepEqual(problems, ['width and height 1920x1200 have ratio 1.6000, not within 1 percent of aspect 16:9 (1.7778)']);
  });

  it('accepts every aspect at a matching size and rejects a 64:27 frame as 21:9', () => {
    const sizes: Readonly<Record<string, readonly [number, number]>> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '21:9': [2520, 1080] };
    for (const aspect of AspectValues) {
      const [width, height] = sizes[aspect] ?? [0, 0];
      assert.deepEqual(checkBrief(mutated(briefExample, (copy) => { copy.aspect = aspect; copy.width = width; copy.height = height; }), noDataDir), [], aspect);
    }
    const problems = checkBrief(mutated(briefExample, (copy) => { copy.aspect = '21:9'; copy.width = 2560; copy.height = 1080; }), noDataDir);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /2560x1080 have ratio 2\.3704, not within 1 percent of aspect 21:9/);
  });

  it('reports a duration that is not positive', () => {
    assert.deepEqual(checkBrief(mutated(briefExample, (copy) => { copy.durationSeconds = 0; }), noDataDir), ['durationSeconds must be greater than 0; got 0']);
    assert.deepEqual(checkBrief(mutated(briefExample, (copy) => { copy.durationSeconds = -2; }), noDataDir), ['durationSeconds must be greater than 0; got -2']);
  });

  it('requires music.path exactly when music.policy is user-supplied', () => {
    assert.deepEqual(checkBrief(mutated(briefExample, (copy) => { copy.music = { policy: 'user-supplied', path: null }; }), noDataDir), ['music.path must name the music file when music.policy is user-supplied']);
    assert.deepEqual(checkBrief(mutated(briefExample, (copy) => { copy.music = { policy: 'none', path: 'C:/music/bed.wav' }; }), noDataDir), ['music.path must be null when music.policy is none; got C:/music/bed.wav']);
    assert.deepEqual(checkBrief(mutated(briefExample, (copy) => { copy.music = { policy: 'user-supplied', path: 'C:/music/bed.wav' }; }), noDataDir), []);
  });

  it('does not consult the ledger without a data directory', () => {
    assert.deepEqual(checkBrief(mutated(briefExample, (copy) => { copy.subject.assetIds = ['model:bottle']; }), noDataDir), []);
  });

  it('reports subject assets the ledger does not record, naming the ledger path, and accepts the ones it does', () => {
    const withAssets = mutated(briefExample, (copy) => { copy.subject.assetIds = ['hdri:studio_small_09', 'model:bottle']; });
    const ledgerPath = assetLedgerPath(dataDir);
    assert.deepEqual(checkBrief(withAssets, { dataDir }), [
      `subject.assetIds names asset "hdri:studio_small_09", which is not in the asset ledger at ${ledgerPath}`,
      `subject.assetIds names asset "model:bottle", which is not in the asset ledger at ${ledgerPath}`,
    ]);
    const ledger = new AssetLedger(ledgerPath);
    for (const record of assetsLedgerExample.assets) ledger.record(record);
    ledger.save();
    assert.deepEqual(checkBrief(withAssets, { dataDir }), [`subject.assetIds names asset "model:bottle", which is not in the asset ledger at ${ledgerPath}`]);
    const font = assetsLedgerExample.assets[0];
    assert.ok(font !== undefined);
    ledger.record({ ...font, id: 'model:bottle' });
    ledger.save();
    assert.deepEqual(checkBrief(withAssets, { dataDir }), []);
  });

  it('reports every problem at once, in rule order', () => {
    const problems = checkBrief(mutated(briefExample, (copy) => { copy.width = 1001; copy.durationSeconds = 0; }), noDataDir);
    assert.equal(problems.length, 3);
    assert.match(problems[0] ?? '', /must be even/);
    assert.match(problems[1] ?? '', /not within 1 percent/);
    assert.match(problems[2] ?? '', /durationSeconds/);
  });
});
