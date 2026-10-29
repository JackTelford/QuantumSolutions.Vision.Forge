/**
 * What the solver and the checks agree on: where the subject's anchor sits
 * in world space, which world point the composition grid places (the
 * anchor, or the bottom of the subject for a ground camera), whether the
 * grid or the headroom rule owns the vertical placement, and the camera
 * frame of a base pose before any move. Pure functions of their arguments.
 */
import { lookAtQuaternion } from '../camera/placement.ts';
import type { BasePose, CameraFrame, Vector3 } from '../camera/types.ts';
import type { Shot } from '../contracts/shot-spec.ts';
import { headroomGovernsSize } from './sizes.ts';

/** The subject's anchor, the centre of its bounding box: the origin of world space by convention. */
export const subjectAnchor: Vector3 = { x: 0, y: 0, z: 0 };

/**
 * The world point the composition grid places. For every angle but
 * `ground` it is the subject's anchor. A ground camera sits level at the
 * subject's bottom face and cannot centre the anchor without leaving the
 * ground plane, so for `ground` the grid places the centre of that bottom
 * face (anchor.y − h / 2), the point placeCamera already looks at.
 */
export function framingPoint(shot: Shot): Vector3 {
  if (shot.angle !== 'ground') return subjectAnchor;
  return { x: subjectAnchor.x, y: subjectAnchor.y - shot.subject.boundsM.h / 2, z: subjectAnchor.z };
}

/** Which rule decides the vertical placement of the subject in the frame. */
export type VerticalPlacement = 'grid' | 'headroom' | 'angle';

/**
 * Who owns the vertical placement: `angle` for a ground camera, whose
 * height is the point of the angle; `headroom` for MS, MCU and CU, where
 * composition.headroomPct puts the subject's top a fixed fraction below
 * the top edge; `grid` otherwise, where the grid point's y is used.
 * `angle` wins over `headroom`: a level ground camera frames the subject
 * from its bottom face, its top lands near the frame top, and no headroom
 * slide is applied, so MS, MCU and CU on `ground` fail checks 1 and 4 by
 * construction; `ground` is for MLS and wider.
 */
export function verticalPlacement(shot: Shot): VerticalPlacement {
  if (shot.angle === 'ground') return 'angle';
  return headroomGovernsSize(shot.size) ? 'headroom' : 'grid';
}

/**
 * The camera frame of a base pose before any move: the pose's position,
 * its look-at orientation with the dutch roll, and the shot's lens. The
 * solver projects through it while it places the camera; a bake replaces
 * it once the move is applied.
 */
export function baseFrame(shot: Shot, pose: BasePose): CameraFrame {
  return {
    frame: 0,
    position: pose.position,
    rotation: lookAtQuaternion(pose.position, pose.target, pose.rollDeg),
    focalMm: shot.lens.focalMm,
    fStop: shot.lens.fStop,
    focusDistanceM: shot.lens.focusDistanceM,
    shutterAngleDeg: shot.lens.shutterAngleDeg,
    exposureEv: shot.exposureOffsetEv,
    subjectRotationDeg: 0,
    keyLightOrbitDeg: 0,
    stageOffset: { x: 0, y: 0 },
  };
}
