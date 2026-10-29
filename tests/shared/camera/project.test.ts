import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFrameAt } from '../../../src/shared/camera/bake.ts';
import { sensorHeightMm, sensorWidthMm } from '../../../src/shared/camera/model.ts';
import { boxCorners, project, projectBox } from '../../../src/shared/camera/project.ts';
import { vector3 } from '../../../src/shared/camera/vector.ts';
import { anchor, aspect, assertClose, basePoseFor, bottleBounds, heroDistanceM, heroFocalMm, makeShot, renderSpec } from './fixtures.ts';

const epsilon = 1e-9;
const heroFrame = cameraFrameAt(makeShot(), renderSpec, basePoseFor(makeShot()), 0);

describe('project', () => {
  it('puts the anchor at the centre with its depth equal to the camera distance', () => {
    const projected = project(anchor, heroFrame, aspect);
    assert.ok(projected !== null);
    assertClose(projected.x, 0.5, 1e-6, 'x');
    assertClose(projected.y, 0.5, 1e-6, 'y');
    assertClose(projected.depth, heroDistanceM, epsilon, 'depth');
  });

  it('maps a world offset to frame fractions through the pinhole: focal × offset / (depth × sensor edge)', () => {
    const right = project(vector3(0.1, 0, 0), heroFrame, aspect);
    const up = project(vector3(0, 0.1, 0), heroFrame, aspect);
    assert.ok(right !== null && up !== null);
    assertClose(right.x, 0.5 + (heroFocalMm * 0.1) / (heroDistanceM * sensorWidthMm(aspect)), epsilon, 'right x');
    assertClose(right.y, 0.5, epsilon, 'right y');
    assertClose(up.y, 0.5 - (heroFocalMm * 0.1) / (heroDistanceM * sensorHeightMm(aspect)), epsilon, 'up y');
    assert.ok(up.y < 0.5, 'up is toward the top of the frame (smaller y)');
  });

  it('returns null for a point behind or on the camera plane', () => {
    assert.equal(project(vector3(0, 0, heroDistanceM + 1), heroFrame, aspect), null);
    assert.equal(project(heroFrame.position, heroFrame, aspect), null);
  });

  it('makes a nearer point larger in the frame than a farther one', () => {
    const near = project(vector3(0.1, 0, 1), heroFrame, aspect);
    const far = project(vector3(0.1, 0, -1), heroFrame, aspect);
    assert.ok(near !== null && far !== null);
    assert.ok(near.x - 0.5 > far.x - 0.5);
  });
});

describe('projectBox', () => {
  it('lists the eight corners of the box around the anchor', () => {
    const corners = boxCorners(bottleBounds, anchor);
    assert.equal(corners.length, 8);
    assert.ok(corners.some((corner) => corner.x === -0.04 && corner.y === -0.125 && corner.z === -0.04));
    assert.ok(corners.some((corner) => corner.x === 0.04 && corner.y === 0.125 && corner.z === 0.04));
  });

  it('bounds the bottle symmetrically around the centre, a little taller than the anchor plane fraction because the near face is closer', () => {
    const box = projectBox(bottleBounds, anchor, heroFrame, aspect);
    assert.ok(box !== null);
    assertClose(box.x + box.w / 2, 0.5, epsilon, 'horizontal centre');
    assertClose(box.y + box.h / 2, 0.5, epsilon, 'vertical centre');
    const nearFaceHeight = (heroFocalMm * bottleBounds.h) / ((heroDistanceM - bottleBounds.d / 2) * sensorHeightMm(aspect));
    assertClose(box.h, nearFaceHeight, epsilon, 'height from the near face');
    assert.ok(box.h > 0.475 && box.h < 0.5, `height ${box.h}`);
  });

  it('is null when any corner is behind the camera', () => {
    assert.equal(projectBox(bottleBounds, heroFrame.position, heroFrame, aspect), null);
  });
});
