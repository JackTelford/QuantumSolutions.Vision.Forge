/**
 * The composition solver: the base pose of a shot from its size, lens,
 * angle and composition (composition/rules.md "Size to distance"). The
 * distance comes from the size and the lens, the angle puts the camera on
 * the sphere of that radius, then the camera and its target slide together
 * in the camera's own right/up plane, which keeps the distance and the
 * view direction, until the subject lands where the composition asks:
 *
 * 1. the grid point of composition.anchor (x always; y only when the grid
 *    owns the vertical placement, see framing.ts);
 * 2. headroom: for MS, MCU and CU the subject's projected top sits
 *    composition.headroomPct / 100 of the frame height below the top edge;
 * 3. lead room: when the subject has a facing direction (the text side),
 *    at least composition.leadRoomPct / 100 of the frame width stays free
 *    between the subject's projected box and the frame edge it faces; the
 *    framing shifts away from that edge only when the grid leaves less.
 *
 * The slide is closed-form. A point at depth z metres projects at
 * x = 0.5 + f·cx / (z·sensorWidth) and y = 0.5 − f·cy / (z·sensorHeight)
 * (project.ts), with cx and cy its camera-space offsets in metres, f the
 * focal length and the sensor edges in millimetres. Moving the camera by d
 * metres along its right axis changes cx by −d and leaves z unchanged, so
 * the point moves by −f·d / (z·sensorWidth) of the frame width; to move it
 * by Δx the camera moves d = −Δx · z · sensorWidth / f. Along the camera's
 * up axis a move of d changes cy by −d and y by +f·d / (z·sensorHeight), so
 * Δy needs d = Δy · z · sensorHeight / f. For a single point this is exact.
 * An edge of the subject's projected box is set by one corner of the box,
 * which is nearer than the anchor, so the box steps slide at that corner's
 * depth (the topmost corner for headroom, the corner nearest the facing
 * edge for lead room) and are exact in one pass as well; they re-measure
 * a few times only in case the slide hands the edge to another corner.
 */
import { sensorHeightMm, sensorWidthMm, verticalFovDegrees } from '../camera/model.ts';
import { distanceForSize, placeCamera } from '../camera/placement.ts';
import { boxCorners, project } from '../camera/project.ts';
import { rotateVector } from '../camera/quaternion.ts';
import type { BasePose, CameraFrame, ProjectedPoint, RenderSpec, Vector3 } from '../camera/types.ts';
import { add, scale } from '../camera/vector.ts';
import type { Shot } from '../contracts/shot-spec.ts';
import { baseFrame, framingPoint, subjectAnchor, verticalPlacement } from './framing.ts';
import type { FramePoint } from './grid.ts';
import { gridPoint } from './grid.ts';
import { targetFraction } from './sizes.ts';

/** How many times a box-edge step re-measures the projected box: the first pass is exact, the others only guard against the edge passing to another corner. */
export const boxStepPasses = 3;

/** A residual below this fraction of the frame ends a box-edge step early (the exact step leaves about 1e-16). */
export const boxStepEpsilon = 1e-7;

/** A shift of the framing in frame fractions: Δx of the width (positive moves the picture content right), Δy of the height (positive moves it down). */
export interface FrameShift {
  readonly x: number;
  readonly y: number;
}

/** What one pass of a box-edge step asks for: the shift of the framing and the depth in metres of the corner that defines the measured edge. */
export interface BoxStep {
  readonly shift: FrameShift;
  readonly depthM: number;
}

/** The camera's right axis (local +X) in world space for a frame, after the roll. */
function rightAxis(frame: CameraFrame): Vector3 {
  return rotateVector(frame.rotation, { x: 1, y: 0, z: 0 });
}

/** The camera's up axis (local +Y) in world space for a frame, after the roll. */
function upAxis(frame: CameraFrame): Vector3 {
  return rotateVector(frame.rotation, { x: 0, y: 1, z: 0 });
}

/**
 * Slides the camera and its target together so that a point at `depthM`
 * metres along the view axis moves by `shift` in the picture (the formula
 * in the file header). Distance, view direction and roll are unchanged.
 */
export function slideFraming(pose: BasePose, frame: CameraFrame, shift: FrameShift, depthM: number, aspect: number): BasePose {
  const metresRight = (-shift.x * depthM * sensorWidthMm(aspect)) / frame.focalMm;
  const metresUp = (shift.y * depthM * sensorHeightMm(aspect)) / frame.focalMm;
  const offset = add(scale(rightAxis(frame), metresRight), scale(upAxis(frame), metresUp));
  return {
    position: add(pose.position, offset),
    target: add(pose.target, offset),
    rollDeg: pose.rollDeg,
    distanceM: pose.distanceM,
  };
}

/** The eight corners of the subject's box projected through a frame, or null when any corner is behind the camera. */
function projectedCorners(shot: Shot, frame: CameraFrame, aspect: number): readonly ProjectedPoint[] | null {
  const corners: ProjectedPoint[] = [];
  for (const corner of boxCorners(shot.subject.boundsM, subjectAnchor)) {
    const projected = project(corner, frame, aspect);
    if (projected === null) return null;
    corners.push(projected);
  }
  return corners;
}

/** The projected corner with the smallest value of `measure` (the first one on a tie). */
function extremeCorner(corners: readonly ProjectedPoint[], measure: (corner: ProjectedPoint) => number): ProjectedPoint {
  return corners.reduce((best, corner) => (measure(corner) < measure(best) ? corner : best));
}

/**
 * Step 1: lands the framing point on the grid point in one exact slide.
 * Δx is always the grid's; Δy only when the grid owns the vertical
 * placement (headroom and the ground angle own it otherwise).
 */
export function placeOnGrid(shot: Shot, pose: BasePose, aspect: number): BasePose {
  const frame = baseFrame(shot, pose);
  const projected = project(framingPoint(shot), frame, aspect);
  if (projected === null) return pose;
  const grid: FramePoint = gridPoint(shot.composition.anchor);
  const shift: FrameShift = {
    x: grid.x - projected.x,
    y: verticalPlacement(shot) === 'grid' ? grid.y - projected.y : 0,
  };
  return slideFraming(pose, frame, shift, projected.depth, aspect);
}

/**
 * Repeats a box-edge measurement: `measure` looks at the projected corners
 * of the subject's box and says how far the edge it cares about is from
 * where it should be, as a frame shift, together with the depth of the
 * corner that defines that edge; the pose slides by the shift at that
 * depth, which is exact for that corner, until the residual is below
 * boxStepEpsilon or the passes run out (a later pass only matters when the
 * slide hands the edge to another corner). A box behind the camera stops
 * the step with the pose unchanged.
 */
function slideUntilBoxFits(shot: Shot, pose: BasePose, aspect: number, measure: (corners: readonly ProjectedPoint[]) => BoxStep): BasePose {
  let current = pose;
  for (let pass = 0; pass < boxStepPasses; pass += 1) {
    const frame = baseFrame(shot, current);
    const corners = projectedCorners(shot, frame, aspect);
    if (corners === null) return current;
    const step = measure(corners);
    if (Math.abs(step.shift.x) < boxStepEpsilon && Math.abs(step.shift.y) < boxStepEpsilon) return current;
    current = slideFraming(current, frame, step.shift, step.depthM, aspect);
  }
  return current;
}

/**
 * Step 2: for the sizes with a headroom range, slides the framing so the
 * subject's projected top (its topmost corner) sits
 * composition.headroomPct / 100 of the frame height below the top edge.
 * Other sizes and the ground angle keep their vertical placement.
 */
export function placeHeadroom(shot: Shot, pose: BasePose, aspect: number): BasePose {
  if (verticalPlacement(shot) !== 'headroom') return pose;
  const wantedTop = shot.composition.headroomPct / 100;
  return slideUntilBoxFits(shot, pose, aspect, (corners) => {
    const top = extremeCorner(corners, (corner) => corner.y);
    return { shift: { x: 0, y: wantedTop - top.y }, depthM: top.depth };
  });
}

/** The direction the subject faces, taken from the side its text sits on: 1 for right, -1 for left, 0 when it has none. */
export function facingDirection(shot: Shot): -1 | 0 | 1 {
  switch (shot.composition.textSide) {
    case 'left':
      return -1;
    case 'right':
      return 1;
    default:
      return 0;
  }
}

/**
 * Step 3: keeps at least composition.leadRoomPct / 100 of the frame width
 * free in front of the subject's projected box on the side it faces. When
 * the grid already leaves that much the pose is unchanged; otherwise the
 * framing slides away from the facing edge by the shortfall.
 */
export function placeLeadRoom(shot: Shot, pose: BasePose, aspect: number): BasePose {
  const facing = facingDirection(shot);
  if (facing === 0 || shot.composition.leadRoomPct <= 0) return pose;
  const wantedFree = shot.composition.leadRoomPct / 100;
  return slideUntilBoxFits(shot, pose, aspect, (corners) => {
    const leading = extremeCorner(corners, (corner) => (facing === 1 ? -corner.x : corner.x));
    const free = facing === 1 ? 1 - leading.x : leading.x;
    const shortfall = wantedFree - free;
    return { shift: { x: shortfall > 0 ? -facing * shortfall : 0, y: 0 }, depthM: leading.depth };
  });
}

/**
 * The base pose of a shot: the camera at the distance that gives the
 * size's target fraction through the lens, at the angle's azimuth and
 * elevation with the dutch roll, then slid onto the grid point, to the
 * headroom and to the lead room, in that order. Pure: the same shot and
 * spec always give the same pose.
 *
 * A ground camera owns the vertical placement (framing.ts): it stays level
 * at the subject's bottom face, so the subject's top projects near the
 * frame top and a headroom-governed size (MS, MCU, CU) on `ground` fails
 * checks 1 and 4 by construction. Pair `ground` with MLS or wider
 * (shot-grammar.md uses it for atmosphere plates).
 */
export function solveBasePose(shot: Shot, spec: RenderSpec): BasePose {
  const aspect = spec.width / spec.height;
  const vfovDeg = verticalFovDegrees(shot.lens.focalMm, aspect);
  const distanceM = distanceForSize(shot.subject.boundsM.h, targetFraction(shot.size), vfovDeg);
  const placed = placeCamera(subjectAnchor, distanceM, shot.angle, shot.dutchDegrees, shot.subject.boundsM.h);
  const onGrid = placeOnGrid(shot, placed, aspect);
  const withHeadroom = placeHeadroom(shot, onGrid, aspect);
  return placeLeadRoom(shot, withHeadroom, aspect);
}
