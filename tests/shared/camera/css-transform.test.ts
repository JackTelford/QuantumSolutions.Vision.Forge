import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFrameAt } from '../../../src/shared/camera/bake.ts';
import { cssProjectedPoint, identityMatrix4, multiplyMatrix4, rotationMatrix4, stageMatrix, stagePxPerMetre, stageTransform, stageTransformValue, toCssMatrix3d, transformPoint, translationMatrix4, worldPointToStage, stagePointToWorld, layerTransform } from '../../../src/shared/camera/css-transform.ts';
import { cssPerspectivePx } from '../../../src/shared/camera/model.ts';
import { project } from '../../../src/shared/camera/project.ts';
import { fromAxisAngle, rotateVector } from '../../../src/shared/camera/quaternion.ts';
import type { Vector3 } from '../../../src/shared/camera/types.ts';
import { vector3 } from '../../../src/shared/camera/vector.ts';
import { aspect, assertClose, basePoseFor, heroDistanceM, heroFocalMm, makeShot, renderSpec } from './fixtures.ts';

const points: readonly Vector3[] = [vector3(0, 0, 0), vector3(0.1, 0.05, 0), vector3(-0.3, 0.2, -0.5), vector3(0.25, -0.1, 0.4)];

/** Where project.ts puts a world point, in pixels from the frame centre with y down. */
function pinholePx(point: Vector3, frame: ReturnType<typeof cameraFrameAt>): { readonly x: number; readonly y: number } {
  const projected = project(point, frame, aspect);
  assert.ok(projected !== null);
  return { x: (projected.x - 0.5) * renderSpec.width, y: (projected.y - 0.5) * renderSpec.height };
}

describe('matrix helpers', () => {
  it('multiplies by the identity without change and composes translations', () => {
    const t = translationMatrix4(1, 2, 3);
    assert.deepEqual(multiplyMatrix4(identityMatrix4, t), t);
    assert.deepEqual(transformPoint(multiplyMatrix4(t, t), vector3(0, 0, 0)), vector3(2, 4, 6));
  });

  it('builds the rotation matrix that agrees with rotateVector', () => {
    const q = fromAxisAngle(vector3(0, 1, 0), Math.PI / 3);
    const v = vector3(0.3, -0.2, 0.9);
    const expected = rotateVector(q, v);
    const actual = transformPoint(rotationMatrix4(q), v);
    assertClose(actual.x, expected.x, 1e-12, 'x');
    assertClose(actual.y, expected.y, 1e-12, 'y');
    assertClose(actual.z, expected.z, 1e-12, 'z');
  });

  it('lists CSS matrix3d arguments column first', () => {
    const t = translationMatrix4(5, 6, 7);
    const css = toCssMatrix3d(t);
    assert.deepEqual(css.slice(12, 15), [5, 6, 7]);
    assert.equal(css[0], 1);
  });

  it('converts stage pixels and world metres both ways with y flipped', () => {
    const world = vector3(0.5, 0.25, -1);
    const stage = worldPointToStage(world, 1000);
    assert.deepEqual(stage, vector3(500, -250, -1000));
    assert.deepEqual(stagePointToWorld(stage, 1000), world);
  });
});

describe('stageTransform', () => {
  const shot = makeShot();
  const pose = basePoseFor(shot);
  const u = stagePxPerMetre(renderSpec, heroFocalMm, heroDistanceM);

  it('scales the stage so a layer on the subject plane renders at 1:1 at the base pose', () => {
    assertClose(u, cssPerspectivePx(heroFocalMm, aspect, renderSpec.height) / heroDistanceM, 1e-9, 'px per metre');
    const frame = cameraFrameAt(shot, renderSpec, pose, 0);
    const a = cssProjectedPoint(worldPointToStage(vector3(0, 0, 0), u), frame, renderSpec, u);
    const b = cssProjectedPoint(worldPointToStage(vector3(0.1, 0, 0), u), frame, renderSpec, u);
    assert.ok(a !== null && b !== null);
    assertClose(b.x - a.x, 0.1 * u, 1e-6, 'a 0.1 m layer offset on the subject plane is 0.1·u px wide at the base pose');
  });

  it('projects every stage point exactly where the pinhole projection puts it, for a static frame', () => {
    const frame = cameraFrameAt(shot, renderSpec, pose, 0);
    for (const point of points) {
      const expected = pinholePx(point, frame);
      const actual = cssProjectedPoint(worldPointToStage(point, u), frame, renderSpec, u);
      assert.ok(actual !== null, `point ${JSON.stringify(point)} is in front of the eye`);
      assertClose(actual.x, expected.x, 1e-6, `x of ${JSON.stringify(point)}`);
      assertClose(actual.y, expected.y, 1e-6, `y of ${JSON.stringify(point)}`);
    }
  });

  it('agrees with the pinhole projection through a push-in, an arc, a tilt, a dutch roll and a zoom', () => {
    const variants = [
      makeShot({ move: { preset: 'push-in', amplitude: 1, easing: 'standard', startFrame: 0, endFrame: 60 } }),
      makeShot({ move: { preset: 'arc-right', amplitude: 1, easing: 'sine-in-out', startFrame: 0, endFrame: 60 } }),
      makeShot({ move: { preset: 'tilt-up', amplitude: 0.5, easing: 'ease-in-out', startFrame: 0, endFrame: 60 } }),
      makeShot({ angle: 'dutch', dutchDegrees: 8 }),
      makeShot({ move: { preset: 'zoom-in', amplitude: 1, easing: 'standard', startFrame: 0, endFrame: 60 } }),
    ];
    for (const variant of variants) {
      const variantPose = basePoseFor(variant);
      const scale = stagePxPerMetre(renderSpec, variant.lens.focalMm, variantPose.distanceM);
      for (const k of [0, 17, 45, 59]) {
        const frame = cameraFrameAt(variant, renderSpec, variantPose, k);
        for (const point of points) {
          const expected = pinholePx(point, frame);
          const actual = cssProjectedPoint(worldPointToStage(point, scale), frame, renderSpec, scale);
          assert.ok(actual !== null);
          assertClose(actual.x, expected.x, 1e-5, `${variant.move.preset} ${variant.angle} frame ${k} x of ${JSON.stringify(point)}`);
          assertClose(actual.y, expected.y, 1e-5, `${variant.move.preset} ${variant.angle} frame ${k} y of ${JSON.stringify(point)}`);
        }
      }
    }
  });

  it('returns null for a stage point at or behind the eye', () => {
    const frame = cameraFrameAt(shot, renderSpec, pose, 0);
    const behind = worldPointToStage(vector3(0, 0, heroDistanceM + 0.5), u);
    assert.equal(cssProjectedPoint(behind, frame, renderSpec, u), null);
  });

  it('follows the focal length into the perspective and keeps the pixel scale fixed', () => {
    const zoom = makeShot({ move: { preset: 'zoom-in', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: 60 } });
    const zoomPose = basePoseFor(zoom);
    const scale = stagePxPerMetre(renderSpec, zoom.lens.focalMm, zoomPose.distanceM);
    const first = stageTransform(cameraFrameAt(zoom, renderSpec, zoomPose, 0), renderSpec, scale);
    const last = stageTransform(cameraFrameAt(zoom, renderSpec, zoomPose, 59), renderSpec, scale);
    assert.ok(last.perspectivePx > first.perspectivePx, 'a zoom-in lengthens the focal length and the perspective');
    assert.equal(first.pxPerMetre, last.pxPerMetre);
  });

  it('formats the CSS values with fixed decimals', () => {
    const frame = cameraFrameAt(shot, renderSpec, pose, 0);
    const value = stageTransformValue(stageTransform(frame, renderSpec, u));
    assert.match(value, /^matrix3d\((-?\d+\.\d{6}, ){15}-?\d+\.\d{6}\)$/);
    assert.equal(layerTransform(vector3(1, -2.5, 3.00049)), 'translate3d(1.000px, -2.500px, 3.000px)');
    assert.equal(stageMatrix(frame, renderSpec, u).length, 16);
  });
});
