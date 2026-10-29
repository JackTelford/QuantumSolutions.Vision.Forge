import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFrameAt } from '../../../src/shared/camera/bake.ts';
import { verticalFovDegrees } from '../../../src/shared/camera/model.ts';
import {
  anglePlacement,
  distanceForSize,
  lookAtQuaternion,
  placeCamera,
  sphericalAngles,
  sphericalPoint,
  viewBasis,
} from '../../../src/shared/camera/placement.ts';
import { project } from '../../../src/shared/camera/project.ts';
import { rotateVector } from '../../../src/shared/camera/quaternion.ts';
import { CameraAngleValues } from '../../../src/shared/contracts/shot-spec.ts';
import { distance, vector3 } from '../../../src/shared/camera/vector.ts';
import { anchor, aspect, assertClose, assertVectorClose, basePoseFor, bottleBounds, heroDistanceM, heroFocalMm, makeShot, mediumShotFraction, renderSpec } from './fixtures.ts';

const epsilon = 1e-9;
const centreEpsilon = 1e-6;
const localForward = vector3(0, 0, -1);
const localUp = vector3(0, 1, 0);

describe('distanceForSize', () => {
  it('places an MS of the 0.25 m bottle at 85 mm about 2.21 m away', () => {
    const vfov = verticalFovDegrees(heroFocalMm, aspect);
    assertClose(distanceForSize(bottleBounds.h, mediumShotFraction, vfov), 2.209, 0.001, 'distance');
    assert.equal(heroDistanceM, distanceForSize(bottleBounds.h, mediumShotFraction, vfov));
  });

  it('projects the bottle\'s top and bottom exactly the requested fraction apart at that distance', () => {
    const shot = makeShot();
    const frame = cameraFrameAt(shot, renderSpec, basePoseFor(shot), 0);
    const top = project(vector3(0, bottleBounds.h / 2, 0), frame, aspect);
    const bottom = project(vector3(0, -bottleBounds.h / 2, 0), frame, aspect);
    assert.ok(top !== null && bottom !== null);
    assertClose(bottom.y - top.y, mediumShotFraction, 1e-9, 'subject height fraction');
  });

  it('halves the distance when the subject should fill twice the frame', () => {
    const vfov = verticalFovDegrees(50, aspect);
    assertClose(distanceForSize(1, 0.5, vfov) * 2, distanceForSize(1, 0.25, vfov), epsilon, 'inverse in the fraction');
  });
});

describe('anglePlacement', () => {
  it('names the azimuth and elevation of every angle in shot-grammar.md', () => {
    assert.deepEqual(anglePlacement('eye'), { azimuthDeg: 0, elevationDeg: 0 });
    assert.deepEqual(anglePlacement('low'), { azimuthDeg: 0, elevationDeg: -15 });
    assert.deepEqual(anglePlacement('high'), { azimuthDeg: 0, elevationDeg: 22.5 });
    assert.deepEqual(anglePlacement('overhead'), { azimuthDeg: 0, elevationDeg: 90 });
    assert.deepEqual(anglePlacement('ground'), { azimuthDeg: 0, elevationDeg: 0 });
    assert.deepEqual(anglePlacement('dutch'), { azimuthDeg: 0, elevationDeg: 0 });
    for (const angle of CameraAngleValues) assert.ok(anglePlacement(angle) !== undefined, angle);
  });
});

describe('sphericalPoint', () => {
  it('puts azimuth 0 elevation 0 on the +Z axis, positive azimuth toward +X and positive elevation above', () => {
    assertVectorClose(sphericalPoint(anchor, 2, 0, 0), vector3(0, 0, 2), epsilon, 'front');
    assertVectorClose(sphericalPoint(anchor, 2, 90, 0), vector3(2, 0, 0), epsilon, 'right');
    assertVectorClose(sphericalPoint(anchor, 2, 0, 90), vector3(0, 2, 0), epsilon, 'overhead');
    assertVectorClose(sphericalPoint(anchor, 2, 0, -30), vector3(0, -1, Math.sqrt(3)), epsilon, 'below');
  });

  it('recovers the angles it was built from', () => {
    const point = sphericalPoint(vector3(1, 2, 3), 1.5, 35, -20);
    const angles = sphericalAngles(vector3(1, 2, 3), point);
    assertClose(angles.azimuthDeg, 35, epsilon, 'azimuth');
    assertClose(angles.elevationDeg, -20, epsilon, 'elevation');
    assert.deepEqual(sphericalAngles(anchor, anchor), { azimuthDeg: 0, elevationDeg: 0 });
  });
});

describe('placeCamera', () => {
  it('puts the eye-level camera in front of the anchor at the distance, looking at the anchor, level', () => {
    const pose = placeCamera(anchor, 2, 'eye', 0, bottleBounds.h);
    assertVectorClose(pose.position, vector3(0, 0, 2), epsilon, 'position');
    assert.deepEqual(pose.target, anchor);
    assert.equal(pose.rollDeg, 0);
    assert.equal(pose.distanceM, 2);
  });

  it('puts low below the anchor looking up, high above it, and overhead straight above, all on the sphere', () => {
    const low = placeCamera(anchor, 2, 'low', 0, bottleBounds.h);
    const high = placeCamera(anchor, 2, 'high', 0, bottleBounds.h);
    const overhead = placeCamera(anchor, 2, 'overhead', 0, bottleBounds.h);
    assert.ok(low.position.y < 0, 'low sits below');
    assert.ok(high.position.y > 0, 'high sits above');
    assertVectorClose(overhead.position, vector3(0, 2, 0), epsilon, 'overhead');
    for (const pose of [low, high, overhead]) assertClose(distance(pose.position, pose.target), 2, epsilon, 'radius');
  });

  it('drops ground to the subject\'s bottom face and keeps the camera level by dropping the target too', () => {
    const pose = placeCamera(anchor, 2, 'ground', 0, bottleBounds.h);
    assertClose(pose.position.y, -bottleBounds.h / 2, epsilon, 'camera height');
    assertClose(pose.target.y, -bottleBounds.h / 2, epsilon, 'target height');
    assertClose(distance(pose.position, pose.target), 2, epsilon, 'distance');
  });

  it('carries the dutch roll into the pose', () => {
    assert.equal(placeCamera(anchor, 2, 'dutch', 8, bottleBounds.h).rollDeg, 8);
  });
});

describe('lookAtQuaternion', () => {
  it('turns local -Z onto the view direction and local +Y toward world up', () => {
    const position = vector3(1, 0.5, 2);
    const q = lookAtQuaternion(position, anchor, 0);
    const basis = viewBasis(position, anchor);
    assertVectorClose(rotateVector(q, localForward), basis.forward, epsilon, 'forward');
    assertVectorClose(rotateVector(q, localUp), basis.up, epsilon, 'up');
    assert.ok(rotateVector(q, localUp).y > 0, 'the picture\'s top points up');
  });

  it('lands the anchor at the frame centre within 1e-6 for every angle', () => {
    for (const angle of CameraAngleValues) {
      const shot = makeShot({ angle });
      const frame = cameraFrameAt(shot, renderSpec, basePoseFor(shot), 0);
      const target = basePoseFor(shot).target;
      const projected = project(target, frame, aspect);
      assert.ok(projected !== null, angle);
      assertClose(projected.x, 0.5, centreEpsilon, `${angle} x`);
      assertClose(projected.y, 0.5, centreEpsilon, `${angle} y`);
    }
  });

  it('tilts the horizon clockwise for a positive roll: a point to the right of the anchor drops in the picture', () => {
    const shot = makeShot({ angle: 'dutch', dutchDegrees: 10 });
    const frame = cameraFrameAt(shot, renderSpec, basePoseFor(shot), 0);
    const rightOfAnchor = project(vector3(0.2, 0, 0), frame, aspect);
    assert.ok(rightOfAnchor !== null);
    assert.ok(rightOfAnchor.x > 0.5, 'still on the right');
    assert.ok(rightOfAnchor.y > 0.5, `right side drops: y ${rightOfAnchor.y}`);
    const level = project(vector3(0.2, 0, 0), cameraFrameAt(makeShot(), renderSpec, basePoseFor(makeShot()), 0), aspect);
    assert.ok(level !== null);
    assertClose(level.y, 0.5, centreEpsilon, 'level horizon');
  });

  it('is defined straight down with -Z world as the top of the picture', () => {
    const q = lookAtQuaternion(vector3(0, 2, 0), anchor, 0);
    for (const component of [q.x, q.y, q.z, q.w]) assert.ok(Number.isFinite(component));
    assertVectorClose(rotateVector(q, localForward), vector3(0, -1, 0), epsilon, 'forward');
    assertVectorClose(rotateVector(q, localUp), vector3(0, 0, -1), epsilon, 'up');
  });
});
