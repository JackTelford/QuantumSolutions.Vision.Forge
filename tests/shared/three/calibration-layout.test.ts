import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFrameAt } from '../../../src/shared/camera/bake.ts';
import { project } from '../../../src/shared/camera/project.ts';
import { rotateVector } from '../../../src/shared/camera/quaternion.ts';
import type { CameraFrame, Vector3 } from '../../../src/shared/camera/types.ts';
import { add, scale } from '../../../src/shared/camera/vector.ts';
import { calibrationScene } from '../../../src/shared/calibration/scene.ts';
import { calibrationLayout, framePlaneAtAnchor, framePointOnAnchorPlane } from '../../../src/shared/three/calibration-layout.ts';
import type { PatchPlacement } from '../../../src/shared/three/calibration-layout.ts';
import { aspect, basePoseFor, makeShot, renderSpec } from '../camera/fixtures.ts';
import { assertClose } from './fixtures.ts';

const epsilon = 1e-9;
const eyeFrame = cameraFrameAt(makeShot(), renderSpec, basePoseFor(makeShot()), 0);
const dutchShot = makeShot({ angle: 'dutch', dutchDegrees: 6 });
const dutchFrame = cameraFrameAt(dutchShot, renderSpec, basePoseFor(dutchShot), 0);
const highShot = makeShot({ angle: 'high' });
const highFrame = cameraFrameAt(highShot, renderSpec, basePoseFor(highShot), 0);

/** The four corners of a placed patch in world space: centre ± half sizes along the patch's right and up. */
function corners(placement: PatchPlacement): readonly Vector3[] {
  const right = rotateVector(placement.rotation, { x: 1, y: 0, z: 0 });
  const up = rotateVector(placement.rotation, { x: 0, y: 1, z: 0 });
  const out: Vector3[] = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) out.push(add(placement.centre, add(scale(right, sx * placement.widthM), scale(up, sy * placement.heightM))));
  }
  return out;
}

describe('framePlaneAtAnchor', () => {
  it('reports the anchor at the camera distance and a frame that is distance × sensor / focal metres', () => {
    const plane = framePlaneAtAnchor(eyeFrame, aspect);
    assertClose(plane.depthM, eyeFrame.position.z, epsilon, 'depth of an eye-level camera on +Z');
    assertClose(plane.heightM, (plane.depthM * (36 / aspect)) / eyeFrame.focalMm, epsilon, 'height');
    assertClose(plane.widthM, plane.heightM * aspect, epsilon, 'width');
  });

  it('puts a frame fraction back where project() finds it, for a level, a dutch and a high camera', () => {
    for (const frame of [eyeFrame, dutchFrame, highFrame]) {
      for (const [x, y] of [[0.5, 0.5], [0.1, 0.2], [0.9, 0.95]] as const) {
        const projected = project(framePointOnAnchorPlane(x, y, frame, aspect), frame, aspect);
        assert.ok(projected !== null);
        assertClose(projected.x, x, epsilon, `x of (${String(x)}, ${String(y)})`);
        assertClose(projected.y, y, epsilon, `y of (${String(x)}, ${String(y)})`);
      }
    }
  });
});

describe('calibrationLayout', () => {
  it('places every patch so its four corners project exactly onto its frame box, for a level, a dutch and a high camera', () => {
    for (const frame of [eyeFrame, dutchFrame, highFrame] as readonly CameraFrame[]) {
      const placements = calibrationLayout(calibrationScene.elements, frame, aspect);
      const patches = placements.filter((placement): placement is PatchPlacement => placement.kind === 'patch');
      assert.equal(patches.length, 9);
      for (const placement of patches) {
        const box = placement.patch.box;
        let left = Number.POSITIVE_INFINITY;
        let top = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;
        let bottom = Number.NEGATIVE_INFINITY;
        for (const corner of corners(placement)) {
          const projected = project(corner, frame, aspect);
          assert.ok(projected !== null);
          left = Math.min(left, projected.x);
          right = Math.max(right, projected.x);
          top = Math.min(top, projected.y);
          bottom = Math.max(bottom, projected.y);
        }
        assertClose(left, box.x, epsilon, `${placement.patch.id} left`);
        assertClose(top, box.y, epsilon, `${placement.patch.id} top`);
        assertClose(right - left, box.w, epsilon, `${placement.patch.id} width`);
        assertClose(bottom - top, box.h, epsilon, `${placement.patch.id} height`);
      }
    }
  });

  it('places the two spheres on the anchor plane with the box height as their diameter and skips the text line', () => {
    const placements = calibrationLayout(calibrationScene.elements, eyeFrame, aspect);
    const spheres = placements.filter((placement) => placement.kind === 'sphere');
    assert.equal(spheres.length, 2);
    assert.equal(placements.length, 11, 'nine patches and two spheres, no text');
    const plane = framePlaneAtAnchor(eyeFrame, aspect);
    for (const placement of spheres) {
      if (placement.kind !== 'sphere') continue;
      assertClose(placement.radiusM, (placement.sphere.box.h * plane.heightM) / 2, epsilon, `${placement.sphere.id} radius`);
      assertClose(placement.centre.z, 0, epsilon, `${placement.sphere.id} on the anchor plane`);
      const projected = project(placement.centre, eyeFrame, aspect);
      assert.ok(projected !== null);
      assertClose(projected.x, placement.sphere.box.x + placement.sphere.box.w / 2, epsilon, `${placement.sphere.id} centre x`);
    }
  });
});
