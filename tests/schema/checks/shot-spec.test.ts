import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { AssetLedger, assetLedgerPath } from '../../../src/net/asset-ledger.ts';
import { semanticCheckCount } from '../../../src/schema/checks/index.ts';
import { checkShotSpec, shotSpecRules, titleSafeMargin, totalFrames } from '../../../src/schema/checks/shot-spec.ts';
import type { ShotSpec } from '../../../src/shared/contracts/shot-spec.ts';
import { assetsLedgerExample, mutated, shotExample, shotSpecExample, textExample } from '../documents/examples.ts';

const noDataDir = { dataDir: undefined };

function withText(change: (text: typeof textExample) => void): ShotSpec {
  return mutated(shotSpecExample, (copy) => {
    const text = copy.shots[2]?.text[0];
    if (text !== undefined) change(text);
  });
}

describe('checkShotSpec', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-shot-spec-check-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('registers every rule under the shot-spec kind', () => {
    assert.equal(semanticCheckCount('shot-spec'), shotSpecRules.length);
    assert.equal(shotSpecRules.length, 9);
  });

  it('passes the example, whose dissolve shortens it by 15 frames', () => {
    assert.deepEqual(checkShotSpec(shotSpecExample, noDataDir), []);
    assert.equal(totalFrames(shotSpecExample), 90 + 90 + 120 - 15);
  });

  it('reports odd dimensions', () => {
    const problems = checkShotSpec(mutated(shotSpecExample, (copy) => { copy.height = 1081; }), noDataDir);
    assert.deepEqual(problems, ['width and height must be even for yuv420p; got 1920x1081']);
  });

  it('reports a shot id used twice, once, and the transition that then names a missing shot', () => {
    const problems = checkShotSpec(mutated(shotSpecExample, (copy) => { (copy.shots[1] as { id: string }).id = 's01'; }), noDataDir);
    assert.deepEqual(problems, ['shot id "s01" is used more than once', 'transition after "s02" names a shot that does not exist']);
  });

  it('reports a text id used twice within one shot but not across shots', () => {
    const twice = mutated(shotSpecExample, (copy) => { copy.shots[2]?.text.push({ ...textExample, box: { x: 0.1, y: 0.1, w: 0.4, h: 0.12 } }); });
    assert.deepEqual(checkShotSpec(twice, noDataDir), ['shot "s03" uses text id "t1" more than once']);
    const acrossShots = mutated(shotSpecExample, (copy) => { copy.shots[1]?.text.push({ ...textExample, outFrame: 80 }); });
    assert.deepEqual(checkShotSpec(acrossShots, noDataDir), []);
  });

  it('reports a move that starts after the shot, ends before it starts or ends after the shot', () => {
    const moveOf = (change: (move: ShotSpec['shots'][number]['move']) => void): ShotSpec => mutated(shotSpecExample, (copy) => { const shot = copy.shots[1]; if (shot !== undefined) change(shot.move); });
    assert.deepEqual(checkShotSpec(moveOf((move) => { move.startFrame = 90; move.endFrame = null; }), noDataDir), ['shot "s02" starts its move at frame 90, at or after its 90 frames']);
    assert.deepEqual(checkShotSpec(moveOf((move) => { move.endFrame = 10; }), noDataDir), ['shot "s02" ends its move at frame 10, not after its start frame 10']);
    assert.deepEqual(checkShotSpec(moveOf((move) => { move.endFrame = 91; }), noDataDir), ['shot "s02" ends its move at frame 91, after its 90 frames']);
    assert.deepEqual(checkShotSpec(moveOf((move) => { move.endFrame = 90; }), noDataDir), []);
  });

  it('reports text frames outside the shot', () => {
    assert.deepEqual(checkShotSpec(withText((text) => { text.inFrame = 120; text.outFrame = null; }), noDataDir), ['text "t1" of shot "s03" enters at frame 120, at or after the shot\'s 120 frames']);
    assert.deepEqual(checkShotSpec(withText((text) => { text.outFrame = 12; }), noDataDir), ['text "t1" of shot "s03" leaves at frame 12, not after it enters at frame 12']);
    assert.deepEqual(checkShotSpec(withText((text) => { text.outFrame = 121; }), noDataDir), ['text "t1" of shot "s03" leaves at frame 121, after the shot\'s 120 frames']);
    assert.deepEqual(checkShotSpec(withText((text) => { text.outFrame = null; }), noDataDir), []);
  });

  it('holds text boxes to the title-safe area, accepting its exact edges', () => {
    assert.equal(titleSafeMargin, 0.05);
    assert.deepEqual(checkShotSpec(withText((text) => { text.box = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; }), noDataDir), []);
    const outside = checkShotSpec(withText((text) => { text.box = { x: 0.04, y: 0.7, w: 0.4, h: 0.12 }; }), noDataDir);
    assert.deepEqual(outside, ['text "t1" of shot "s03" has box x 0.04 y 0.7 w 0.4 h 0.12, outside the title-safe area (0.05 to 0.95 of the frame)']);
    assert.equal(checkShotSpec(withText((text) => { text.box = { x: 0.6, y: 0.7, w: 0.4, h: 0.12 }; }), noDataDir).length, 1);
    assert.equal(checkShotSpec(withText((text) => { text.box = { x: 0.1, y: 0.9, w: 0.4, h: 0.1 }; }), noDataDir).length, 1);
  });

  it('reports transitions that name a missing shot, follow the last shot or repeat a shot', () => {
    const transitionsOf = (transitions: ShotSpec['transitions']): ShotSpec => mutated(shotSpecExample, (copy) => { copy.transitions = transitions; });
    assert.deepEqual(checkShotSpec(transitionsOf([{ afterShotId: 's09', type: 'dissolve', frames: 10 }]), noDataDir), ['transition after "s09" names a shot that does not exist']);
    assert.deepEqual(checkShotSpec(transitionsOf([{ afterShotId: 's03', type: 'dissolve', frames: 10 }]), noDataDir), ['transition after "s03" follows the last shot']);
    assert.deepEqual(checkShotSpec(transitionsOf([{ afterShotId: 's01', type: 'dissolve', frames: 10 }, { afterShotId: 's01', type: 'wipe-left', frames: 10 }]), noDataDir), ['shot "s01" has more than one transition after it']);
  });

  it('reports a transition longer than a neighbour, but lets a cut be any length', () => {
    const transitionsOf = (transitions: ShotSpec['transitions']): ShotSpec => mutated(shotSpecExample, (copy) => { copy.transitions = transitions; });
    assert.deepEqual(checkShotSpec(transitionsOf([{ afterShotId: 's01', type: 'dissolve', frames: 91 }]), noDataDir), ['transition after "s01" is 91 frames, longer than one of its shots']);
    assert.deepEqual(checkShotSpec(transitionsOf([{ afterShotId: 's01', type: 'dissolve', frames: 90 }]), noDataDir), []);
    assert.deepEqual(checkShotSpec(transitionsOf([{ afterShotId: 's01', type: 'cut', frames: 500 }]), noDataDir), []);
  });

  it('reports a spec with no shots and one whose transitions remove every frame', () => {
    assert.deepEqual(checkShotSpec(mutated(shotSpecExample, (copy) => { copy.shots = []; copy.transitions = []; }), noDataDir), ['the spec has no shots']);
    const empty = mutated(shotSpecExample, (copy) => {
      copy.shots = [shotExample('a', 10, 'html'), shotExample('b', 10, 'html')];
      copy.transitions = [{ afterShotId: 'a', type: 'dissolve', frames: 20 }];
    });
    assert.deepEqual(checkShotSpec(empty, noDataDir), ['transition after "a" is 20 frames, longer than one of its shots', 'the transitions remove every frame; the piece would be empty']);
    assert.equal(totalFrames(empty), 0);
  });

  it('reports subject assets the ledger does not record when a data directory is given', () => {
    const withAsset = mutated(shotSpecExample, (copy) => { const shot = copy.shots[0]; if (shot !== undefined) shot.subject.assetId = 'model:bottle'; });
    assert.deepEqual(checkShotSpec(withAsset, noDataDir), []);
    const ledgerPath = assetLedgerPath(dataDir);
    assert.deepEqual(checkShotSpec(withAsset, { dataDir }), [`shot "s01" subject names asset "model:bottle", which is not in the asset ledger at ${ledgerPath}`]);
    const ledger = new AssetLedger(ledgerPath);
    const font = assetsLedgerExample.assets[0];
    assert.ok(font !== undefined);
    ledger.record({ ...font, id: 'model:bottle' });
    ledger.save();
    assert.deepEqual(checkShotSpec(withAsset, { dataDir }), []);
  });
});
