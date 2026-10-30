import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LaneUnavailableError, browserLaneOf, buildShotPageSpec } from '../../src/render/shot-page-spec.ts';
import { bake } from '../../src/shared/camera/bake.ts';
import { solveBasePose } from '../../src/shared/composition/solver.ts';
import { assetsUrlPrefix, fontsUrlPrefix } from '../../src/shared/harness/protocol.ts';
import { lookBibleExample, mutated, shotExample, textExample } from '../schema/documents/examples.ts';

const spec = { fps: 30, width: 480, height: 270 };

describe('buildShotPageSpec', () => {
  it('bakes the camera over the solver\'s base pose and carries the base distance and the URL prefixes', () => {
    const shot = shotExample('s03', 12, 'html');
    const page = buildShotPageSpec(shot, lookBibleExample, spec);
    const pose = solveBasePose(shot, spec);
    assert.equal(page.lane, 'html');
    assert.equal(page.plate, 'picture', 'the picture is the default plate');
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

  it('renders the text plate of a three or blender shot in the html lane with the same baked camera', () => {
    const three = { ...shotExample('s01', 12, 'three'), text: [textExample] };
    const page = buildShotPageSpec(three, lookBibleExample, spec, null, 'text');
    assert.equal(page.lane, 'html');
    assert.equal(page.plate, 'text');
    assert.deepEqual(page.camera, buildShotPageSpec(three, lookBibleExample, spec).camera);
    const blender = { ...three, lane: 'blender' as const };
    assert.equal(buildShotPageSpec(blender, lookBibleExample, spec, null, 'text').lane, 'html', 'a blender shot\'s text plate does not go through its own lane');
  });
});
