import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFrameAt } from '../../../src/shared/camera/bake.ts';
import { verticalFovDegrees } from '../../../src/shared/camera/model.ts';
import { project } from '../../../src/shared/camera/project.ts';
import type { CameraFrame, Vector3 } from '../../../src/shared/camera/types.ts';
import { cameraFarM, cameraNearM, filmGaugeMm, projectThroughPose, stageOffsetShift, threeCameraPose } from '../../../src/shared/three/camera-mapping.ts';
import { aspect, basePoseFor, bottleBounds, makeShot, renderSpec, shotWithMove } from '../camera/fixtures.ts';
import { assertClose } from './fixtures.ts';

const anchor: Vector3 = { x: 0, y: 0, z: 0 };
const samplePoints: readonly Vector3[] = [anchor, { x: 0.1, y: 0, z: 0 }, { x: -0.04, y: 0.125, z: 0.04 }, { x: 0.3, y: -0.2, z: -0.6 }, { x: 0, y: 0.5, z: 0.8 }];
const frames = [0, 20, 45, 59];
const epsilon = 1e-9;

/** The frames of a shot's bake at the sample indexes. */
function framesOf(shot: ReturnType<typeof makeShot>): readonly CameraFrame[] {
  const base = basePoseFor(shot);
  return frames.map((frame) => cameraFrameAt(shot, renderSpec, base, frame));
}

describe('threeCameraPose', () => {
  it('keeps the frame position and quaternion, sets a 36 mm gauge and the near and far planes', () => {
    const frame = framesOf(makeShot())[0] ?? assert.fail('a frame');
    const pose = threeCameraPose(frame, aspect, bottleBounds);
    assert.deepEqual(pose.position, frame.position);
    assert.deepEqual(pose.quaternion, frame.rotation);
    assert.equal(pose.nearM, cameraNearM);
    assert.equal(pose.farM, cameraFarM);
    assert.equal(filmGaugeMm, 36);
  });

  it('gives the vertical field of view three computes from setFocalLength on a 36 mm gauge: 2·atan(gauge / aspect / (2·focal))', () => {
    const frame = framesOf(makeShot())[0] ?? assert.fail('a frame');
    const pose = threeCameraPose(frame, aspect, bottleBounds);
    const threeFov = (2 * Math.atan(filmGaugeMm / Math.max(aspect, 1) / (2 * frame.focalMm)) * 180) / Math.PI;
    assertClose(pose.fovDeg, threeFov, epsilon, 'fov');
    assertClose(pose.fovDeg, verticalFovDegrees(frame.focalMm, aspect), epsilon, 'fov against model.ts');
    const portrait = threeCameraPose(frame, 9 / 16, bottleBounds);
    assertClose(portrait.fovDeg, (2 * Math.atan(filmGaugeMm / (2 * frame.focalMm)) * 180) / Math.PI, epsilon, 'portrait fov uses the full gauge');
  });
});

describe('projectThroughPose', () => {
  it('projects the anchor to the frame centre and a point at +X of the anchor into the right half', () => {
    const frame = framesOf(makeShot())[0] ?? assert.fail('a frame');
    const pose = threeCameraPose(frame, aspect, bottleBounds);
    const centre = projectThroughPose(anchor, pose);
    const right = projectThroughPose({ x: 0.1, y: 0, z: 0 }, pose);
    assert.ok(centre !== null && right !== null);
    assertClose(centre.x, 0.5, 1e-6, 'anchor x');
    assertClose(centre.y, 0.5, 1e-6, 'anchor y');
    assert.ok(right.x > 0.5, `+X lands right of centre: ${String(right.x)}`);
    assertClose(right.y, 0.5, 1e-6, '+X stays on the centre line');
  });

  it('agrees with project() to 1e-9 through a push-in, an arc, a tilt, a dutch roll and a zoom', () => {
    const shots = [shotWithMove('push-in'), shotWithMove('arc-right'), shotWithMove('tilt-up'), makeShot({ angle: 'dutch', dutchDegrees: 8 }), shotWithMove('zoom-in')];
    for (const shot of shots) {
      for (const frame of framesOf(shot)) {
        const pose = threeCameraPose(frame, aspect, bottleBounds);
        for (const point of samplePoints) {
          const expected = project(point, frame, aspect);
          const actual = projectThroughPose(point, pose);
          assert.ok(expected !== null && actual !== null, `${shot.move.preset} frame ${String(frame.frame)} point in front of the camera`);
          assertClose(actual.x, expected.x, epsilon, `${shot.move.preset} frame ${String(frame.frame)} x`);
          assertClose(actual.y, expected.y, epsilon, `${shot.move.preset} frame ${String(frame.frame)} y`);
        }
      }
    }
  });

  it('returns null for a point on or behind the camera plane, like project()', () => {
    const frame = framesOf(makeShot())[0] ?? assert.fail('a frame');
    const pose = threeCameraPose(frame, aspect, bottleBounds);
    assert.equal(projectThroughPose(frame.position, pose), null);
    assert.equal(projectThroughPose({ x: 0, y: 0, z: frame.position.z + 1 }, pose), null);
  });
});

describe('stageOffsetShift', () => {
  it('moves the camera left by x subject widths and up by y subject heights, so the picture slides right and down like the html stage', () => {
    const frame = framesOf(makeShot())[0] ?? assert.fail('a frame');
    const shifted: CameraFrame = { ...frame, stageOffset: { x: 0.5, y: 0.25 } };
    const shift = stageOffsetShift(shifted, bottleBounds);
    assertClose(shift.x, -0.5 * bottleBounds.w, epsilon, 'x');
    assertClose(shift.y, 0.25 * bottleBounds.h, epsilon, 'y');
    assertClose(shift.z, 0, epsilon, 'z');
    const still = projectThroughPose(anchor, threeCameraPose(frame, aspect, bottleBounds));
    const moved = projectThroughPose(anchor, threeCameraPose(shifted, aspect, bottleBounds));
    assert.ok(still !== null && moved !== null);
    assert.ok(moved.x > still.x, 'the anchor moves right in the frame');
    assert.ok(moved.y > still.y, 'the anchor moves down in the frame');
    assert.deepEqual(stageOffsetShift(frame, bottleBounds), { x: 0, y: 0, z: 0 });
  });
});
