import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromAxisAngle, rotateVector } from '../../../src/shared/camera/quaternion.ts';
import { fastWidthPx, ssaaSampleLevel, subFrameCount } from '../../../src/shared/three/quality.ts';
import { slerp, subFrameCamera, subFrameOffsets } from '../../../src/shared/three/sub-frame.ts';
import { assertClose, pushInSpec, threePageSpecFor, turntableShot } from './fixtures.ts';

const epsilon = 1e-9;

describe('subFrameCount', () => {
  it('gives six sub-frames for a 360 degree shutter, four for 180, two for 90, and one at the fast width or below', () => {
    assert.equal(subFrameCount(360, 1920), 6);
    assert.equal(subFrameCount(180, 1920), 4);
    assert.equal(subFrameCount(90, 1920), 2);
    assert.equal(subFrameCount(180, fastWidthPx), 1);
    assert.equal(subFrameCount(360, 480), 1);
  });

  it('uses SSAA level 2 for a full frame and 1 at the fast width', () => {
    assert.equal(ssaaSampleLevel(1920), 2);
    assert.equal(ssaaSampleLevel(640), 1);
  });
});

describe('subFrameOffsets', () => {
  it('spaces the sub-frames evenly across the shutter window, starting at 0', () => {
    assert.deepEqual(subFrameOffsets(180, 4), [0, 0.125, 0.25, 0.375]);
    assert.deepEqual(subFrameOffsets(360, 1), [0]);
    const six = subFrameOffsets(360, 6);
    assert.equal(six.length, 6);
    assertClose(six[5] ?? -1, 5 / 6, epsilon, 'last of six');
  });
});

describe('slerp', () => {
  it('halves a 90 degree rotation about Y into 45 degrees and returns the ends at 0 and 1', () => {
    const start = fromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const end = fromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const half = slerp(start, end, 0.5);
    const turned = rotateVector(half, { x: 0, y: 0, z: -1 });
    assertClose(turned.x, -Math.sin(Math.PI / 4), epsilon, 'x of -Z turned 45 degrees');
    assertClose(turned.z, -Math.cos(Math.PI / 4), epsilon, 'z of -Z turned 45 degrees');
    assert.deepEqual(slerp(start, end, 0), start);
    assertClose(slerp(start, end, 1).y, end.y, epsilon, 'end y');
  });

  it('takes the shorter arc when the second quaternion is negated', () => {
    const start = fromAxisAngle({ x: 0, y: 1, z: 0 }, 0.2);
    const end = fromAxisAngle({ x: 0, y: 1, z: 0 }, 0.4);
    const negated = { x: -end.x, y: -end.y, z: -end.z, w: -end.w };
    const expected = slerp(start, end, 0.5);
    const actual = slerp(start, negated, 0.5);
    for (const key of ['x', 'y', 'z', 'w'] as const) assertClose(Math.abs(actual[key]), Math.abs(expected[key]), epsilon, key);
  });
});

describe('subFrameCamera', () => {
  it('returns camera[frame] itself at offset 0', () => {
    assert.equal(subFrameCamera(pushInSpec.camera, 10, 0), pushInSpec.camera[10]);
  });

  it('holds the last frame of the shot, which has no successor', () => {
    const last = pushInSpec.camera.length - 1;
    assert.equal(subFrameCamera(pushInSpec.camera, last, 0.375), pushInSpec.camera[last]);
  });

  it('interpolates position, focal length, focus and the lane angles linearly, keeping the frame number and the shutter', () => {
    const spec = threePageSpecFor(turntableShot);
    const a = spec.camera[30] ?? assert.fail('frame 30');
    const b = spec.camera[31] ?? assert.fail('frame 31');
    const mid = subFrameCamera(spec.camera, 30, 0.5);
    assert.equal(mid.frame, 30);
    assert.equal(mid.shutterAngleDeg, a.shutterAngleDeg);
    assertClose(mid.subjectRotationDeg, (a.subjectRotationDeg + b.subjectRotationDeg) / 2, epsilon, 'turntable angle');
    assert.ok(b.subjectRotationDeg > a.subjectRotationDeg, 'the turntable turns between frames 30 and 31');
    const push = pushInSpec.camera;
    const pa = push[20] ?? assert.fail('frame 20');
    const pb = push[21] ?? assert.fail('frame 21');
    const pm = subFrameCamera(push, 20, 0.25);
    assertClose(pm.position.z, pa.position.z + (pb.position.z - pa.position.z) * 0.25, epsilon, 'position z');
    assertClose(pm.focusDistanceM, pa.focusDistanceM + (pb.focusDistanceM - pa.focusDistanceM) * 0.25, epsilon, 'focus');
    assertClose(pm.focalMm, pa.focalMm, epsilon, 'focal (constant on a push-in)');
    assert.ok(pa.position.z !== pb.position.z, 'the push-in moves between frames 20 and 21');
  });

  it('throws a sentence for a frame without a baked camera', () => {
    assert.throws(() => subFrameCamera(pushInSpec.camera, 999, 0), /Frame 999 has no baked camera/);
  });
});
