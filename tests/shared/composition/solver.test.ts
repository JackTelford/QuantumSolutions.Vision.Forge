import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFrameAt } from '../../../src/shared/camera/bake.ts';
import { verticalFovDegrees } from '../../../src/shared/camera/model.ts';
import { distanceForSize } from '../../../src/shared/camera/placement.ts';
import { project, projectBox } from '../../../src/shared/camera/project.ts';
import { distance } from '../../../src/shared/camera/vector.ts';
import { compositionProblems } from '../../../src/shared/composition/checks.ts';
import { baseFrame, framingPoint, subjectAnchor, verticalPlacement } from '../../../src/shared/composition/framing.ts';
import { gridPoint } from '../../../src/shared/composition/grid.ts';
import { targetFraction } from '../../../src/shared/composition/sizes.ts';
import { facingDirection, solveBasePose } from '../../../src/shared/composition/solver.ts';
import type { RenderSpec } from '../../../src/shared/camera/types.ts';
import { CameraAngleValues, CompositionAnchorValues } from '../../../src/shared/contracts/shot-spec.ts';
import type { BoundsM, Shot } from '../../../src/shared/contracts/shot-spec.ts';
import { aspect, assertClose, bottleBounds, makeShot, problemsAbout, renderSpec } from './fixtures.ts';

const anchorEpsilon = 0.01;
const exactEpsilon = 1e-9;
/** The box steps slide at the defining corner's depth, so a box edge lands within floating-point noise of where it was asked. */
const boxEpsilon = 1e-6;
/** The lead-room step is exact in one pass as well. */
const leadRoomEpsilon = 1e-6;
/** 1080 × 1920 at 30 fps: a portrait spec, whose 36 mm sensor edge is vertical. */
const portraitSpec: RenderSpec = { fps: 30, width: 1080, height: 1920 };
/** A 1 m cube: a deep subject whose nearest corners sit far in front of its anchor. */
const cubeBounds: BoundsM = { w: 1, h: 1, d: 1 };

/** The frame the baker produces at frame 0 of the solved pose (a static hold, so the base pose itself). */
function solvedFrame(shot: Shot): ReturnType<typeof cameraFrameAt> {
  return cameraFrameAt(shot, renderSpec, solveBasePose(shot, renderSpec), 0);
}

describe('solveBasePose', () => {
  it('lands a product MS hero with thirds-left at x 0.333', () => {
    const shot = makeShot({ composition: { anchor: 'thirds-left', headroomPct: 10, leadRoomPct: 15, textSide: 'right' } });
    const projected = project(subjectAnchor, solvedFrame(shot), aspect);
    assert.ok(projected !== null);
    assertClose(projected.x, 0.333, anchorEpsilon, 'anchor x');
  });

  it('keeps the lens distance from the subject: the size-to-distance formula, the pose distance and the anchor depth agree', () => {
    const shot = makeShot();
    const pose = solveBasePose(shot, renderSpec);
    const expected = distanceForSize(bottleBounds.h, targetFraction('MS'), verticalFovDegrees(85, aspect));
    assertClose(pose.distanceM, expected, exactEpsilon, 'distanceM');
    assertClose(distance(pose.position, pose.target), expected, exactEpsilon, 'position to target');
    const projected = project(subjectAnchor, baseFrame(shot, pose), aspect);
    assert.ok(projected !== null);
    assertClose(projected.depth, expected, exactEpsilon, 'anchor depth');
  });

  it('puts the subject top at 0.10 for a CU with 10 percent headroom', () => {
    const shot = makeShot({ size: 'CU', composition: { anchor: 'center', headroomPct: 10, leadRoomPct: 0, textSide: 'none' } });
    const box = projectBox(bottleBounds, subjectAnchor, solvedFrame(shot), aspect);
    assert.ok(box !== null);
    assertClose(box.y, 0.1, anchorEpsilon, 'subject top');
    assertClose(box.y, 0.1, boxEpsilon, 'subject top after the correction passes');
  });

  it('puts the top of a deep 1 m cube at 0.10 for a CU at 24 mm, where the nearest corner is far in front of the anchor', () => {
    const shot = makeShot({
      size: 'CU',
      lens: { focalMm: 24, fStop: 4, focusDistanceM: 1.5, shutterAngleDeg: 180 },
      subject: { assetId: null, primitive: 'box', boundsM: cubeBounds },
      composition: { anchor: 'center', headroomPct: 10, leadRoomPct: 0, textSide: 'none' },
    });
    const box = projectBox(cubeBounds, subjectAnchor, solvedFrame(shot), aspect);
    assert.ok(box !== null);
    assertClose(box.y, 0.1, boxEpsilon, 'cube top');
  });

  it('lands a portrait MS hero on the thirds-left x with its top at 0.10 and reports no problems', () => {
    const shot = makeShot();
    const pose = solveBasePose(shot, portraitSpec);
    const frame = cameraFrameAt(shot, portraitSpec, pose, 0);
    const portraitAspect = portraitSpec.width / portraitSpec.height;
    const projected = project(subjectAnchor, frame, portraitAspect);
    assert.ok(projected !== null);
    assertClose(projected.x, 0.333, 1e-6, 'anchor x');
    const box = projectBox(bottleBounds, subjectAnchor, frame, portraitAspect);
    assert.ok(box !== null);
    assertClose(box.y, 0.1, boxEpsilon, 'subject top');
    assert.deepEqual(compositionProblems(shot, portraitSpec, frame), []);
  });

  it('passes every check for an ECU macro at 100 mm, where the frame sits inside the subject', () => {
    const shot = makeShot({
      size: 'ECU',
      lens: { focalMm: 100, fStop: 2.8, focusDistanceM: 0.6, shutterAngleDeg: 180 },
      composition: { anchor: 'center', headroomPct: 0, leadRoomPct: 0, textSide: 'none' },
    });
    const frame = solvedFrame(shot);
    const box = projectBox(bottleBounds, subjectAnchor, frame, aspect);
    assert.ok(box !== null);
    assert.ok(box.h > 1, `the subject is taller than the frame: ${box.h}`);
    assert.deepEqual(compositionProblems(shot, renderSpec, frame), []);
  });

  it('passes check 4 for an MS asked for the headroom range edges, 8 and 12 percent', () => {
    for (const headroomPct of [8, 12]) {
      const shot = makeShot({ composition: { anchor: 'thirds-left', headroomPct, leadRoomPct: 15, textSide: 'right' } });
      const frame = solvedFrame(shot);
      const box = projectBox(bottleBounds, subjectAnchor, frame, aspect);
      assert.ok(box !== null);
      assertClose(box.y, headroomPct / 100, boxEpsilon, `subject top at ${headroomPct} percent`);
      assert.deepEqual(problemsAbout(compositionProblems(shot, renderSpec, frame), 'headroom'), [], `${headroomPct} percent`);
    }
  });

  it('lets headroom own the vertical placement of an MS and the grid own it for an FS', () => {
    const mediumShot = makeShot({ composition: { anchor: 'center', headroomPct: 10, leadRoomPct: 0, textSide: 'none' } });
    const mediumBox = projectBox(bottleBounds, subjectAnchor, solvedFrame(mediumShot), aspect);
    assert.ok(mediumBox !== null);
    assertClose(mediumBox.y, 0.1, boxEpsilon, 'MS top from headroom');
    assert.equal(verticalPlacement(mediumShot), 'headroom');
    const fullShot = makeShot({ size: 'FS', composition: { anchor: 'thirds-top', headroomPct: 10, leadRoomPct: 0, textSide: 'none' } });
    const projected = project(subjectAnchor, solvedFrame(fullShot), aspect);
    assert.ok(projected !== null);
    assertClose(projected.y, 0.333, exactEpsilon, 'FS anchor y from the grid');
    assert.equal(verticalPlacement(fullShot), 'grid');
  });

  it('lands the framing point on the grid x for every anchor and angle so check 2 passes', () => {
    for (const anchor of CompositionAnchorValues) {
      for (const angle of CameraAngleValues) {
        const shot = makeShot({ size: 'FS', angle, dutchDegrees: angle === 'dutch' ? 8 : 0, composition: { anchor, headroomPct: 0, leadRoomPct: 0, textSide: 'none' } });
        const frame = solvedFrame(shot);
        const projected = project(framingPoint(shot), frame, aspect);
        assert.ok(projected !== null, `${anchor} ${angle}`);
        assertClose(projected.x, gridPoint(anchor).x, 1e-6, `${anchor} ${angle} x`);
        if (angle !== 'ground') assertClose(projected.y, gridPoint(anchor).y, 1e-6, `${anchor} ${angle} y`);
        assert.deepEqual(problemsAbout(compositionProblems(shot, renderSpec, frame), 'grid point'), [], `${anchor} ${angle}`);
      }
    }
  });

  it('keeps a ground camera level at the subject\'s bottom face', () => {
    const shot = makeShot({ size: 'FS', angle: 'ground', composition: { anchor: 'center', headroomPct: 0, leadRoomPct: 0, textSide: 'none' } });
    const pose = solveBasePose(shot, renderSpec);
    assertClose(pose.position.y, -bottleBounds.h / 2, exactEpsilon, 'camera height');
    assertClose(pose.target.y, -bottleBounds.h / 2, exactEpsilon, 'target height');
  });

  it('carries the dutch roll into the pose and still lands the anchor on the grid', () => {
    const shot = makeShot({ angle: 'dutch', dutchDegrees: 8 });
    const pose = solveBasePose(shot, renderSpec);
    assert.equal(pose.rollDeg, 8);
    const projected = project(subjectAnchor, solvedFrame(shot), aspect);
    assert.ok(projected !== null);
    assertClose(projected.x, 0.333, 1e-6, 'anchor x');
  });

  it('leaves the grid alone when the lead room is already free and slides away from the facing edge when it is not', () => {
    const free = makeShot({ composition: { anchor: 'thirds-left', headroomPct: 10, leadRoomPct: 30, textSide: 'right' } });
    const freeProjected = project(subjectAnchor, solvedFrame(free), aspect);
    assert.ok(freeProjected !== null);
    assertClose(freeProjected.x, 0.333, 1e-6, 'anchor stays on the grid');
    const crowded = makeShot({ composition: { anchor: 'thirds-right', headroomPct: 10, leadRoomPct: 30, textSide: 'right' } });
    const box = projectBox(bottleBounds, subjectAnchor, solvedFrame(crowded), aspect);
    assert.ok(box !== null);
    const freeWidth = 1 - (box.x + box.w);
    assert.ok(freeWidth >= 0.3, `at least the lead room is free: ${freeWidth}`);
    assertClose(freeWidth, 0.3, leadRoomEpsilon, 'free width in front of the subject');
    assert.equal(facingDirection(crowded), 1);
    assert.equal(facingDirection(makeShot({ composition: { anchor: 'center', headroomPct: 10, leadRoomPct: 15, textSide: 'none' } })), 0);
  });

  it('is pure: the same shot and spec give the same pose', () => {
    const shot = makeShot({ angle: 'high', composition: { anchor: 'golden-right', headroomPct: 9, leadRoomPct: 20, textSide: 'left' } });
    assert.deepEqual(solveBasePose(shot, renderSpec), solveBasePose(shot, renderSpec));
    assert.deepEqual(solveBasePose(makeShot(), renderSpec), solveBasePose(makeShot(), renderSpec));
  });
});
