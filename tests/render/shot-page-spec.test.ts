import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LaneUnavailableError, browserLaneOf, buildShotPageSpec } from '../../src/render/shot-page-spec.ts';
import { bake } from '../../src/shared/camera/bake.ts';
import { solveBasePose } from '../../src/shared/composition/solver.ts';
import { assetsUrlPrefix, fontsUrlPrefix } from '../../src/shared/harness/protocol.ts';
import { lookBibleExample, mutated, shotExample } from '../schema/documents/examples.ts';

const spec = { fps: 30, width: 480, height: 270 };

describe('buildShotPageSpec', () => {
  it('bakes the camera over the solver\'s base pose and carries the base distance and the URL prefixes', () => {
    const shot = shotExample('s03', 12, 'html');
    const page = buildShotPageSpec(shot, lookBibleExample, spec);
    const pose = solveBasePose(shot, spec);
    assert.equal(page.lane, 'html');
    assert.deepEqual([page.fps, page.width, page.height], [30, 480, 270]);
    assert.equal(page.camera.length, 12);
    assert.deepEqual(page.camera, bake(shot, spec, pose));
    assert.equal(page.baseDistanceM, pose.distanceM);
    assert.equal(page.fontsUrl, fontsUrlPrefix);
    assert.equal(page.assetsUrl, assetsUrlPrefix);
    assert.equal(page.shot, shot);
    assert.equal(page.look, lookBibleExample);
  });

  it('refuses the blender lane with code lane-unavailable naming its own renderer', () => {
    const blender = mutated(shotExample('s09', 12, 'html'), (copy) => { copy.lane = 'blender'; });
    assert.throws(() => browserLaneOf(blender), (error: unknown) => error instanceof LaneUnavailableError && error.code === 'lane-unavailable' && /blender-shot/.test(error.hint) && /"s09"/.test(error.message));
    assert.throws(() => buildShotPageSpec(blender, lookBibleExample, spec), LaneUnavailableError);
    assert.equal(browserLaneOf(shotExample('s01', 12, 'three')), 'three');
  });
});
