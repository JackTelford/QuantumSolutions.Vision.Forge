/**
 * Where the camera sits before any move: the distance that gives a shot size
 * (composition/rules.md), the azimuth and elevation of each camera angle
 * (shot-grammar.md) and the look-at orientation. The composition solver
 * calls these and hands the resulting BasePose to the baker.
 */
import type { CameraAngle } from '../contracts/shot-spec.ts';
import { toRadians } from './model.ts';
import { fromAxisAngle, fromBasis, multiply } from './quaternion.ts';
import type { AnglePlacement, BasePose, Quaternion, Vector3 } from './types.ts';
import { add, cross, length, normalize, overheadUpReference, scale, subtract, worldUp } from './vector.ts';

/** Below this length of forward × worldUp (metres, for unit vectors) the view is straight up or down and needs the overhead up reference. */
const degenerateUpEpsilon = 1e-9;

/**
 * The camera distance in metres at which a subject of `subjectHeightM`
 * covers `fraction` of the frame height through a lens with the vertical
 * field of view `vfovDeg`: h / (f · 2 · tan(vfov / 2)).
 */
export function distanceForSize(subjectHeightM: number, fraction: number, vfovDeg: number): number {
  return subjectHeightM / (fraction * 2 * Math.tan(toRadians(vfovDeg) / 2));
}

/** The azimuth and elevation of each camera angle, in degrees (shot-grammar.md); `ground` and `dutch` are level and get their height and roll in placeCamera. */
export const anglePlacements: Readonly<Record<CameraAngle, AnglePlacement>> = {
  eye: { azimuthDeg: 0, elevationDeg: 0 },
  low: { azimuthDeg: 0, elevationDeg: -15 },
  high: { azimuthDeg: 0, elevationDeg: 22.5 },
  overhead: { azimuthDeg: 0, elevationDeg: 90 },
  ground: { azimuthDeg: 0, elevationDeg: 0 },
  dutch: { azimuthDeg: 0, elevationDeg: 0 },
};

/** The azimuth and elevation of a camera angle on the sphere around the subject; negative elevation puts the camera below the anchor looking up. */
export function anglePlacement(angle: CameraAngle): AnglePlacement {
  return anglePlacements[angle];
}

/**
 * The point at `distanceM` from `centre` at the given azimuth (about +Y from
 * +Z toward +X) and elevation (above the horizontal plane), in metres.
 */
export function sphericalPoint(centre: Vector3, distanceM: number, azimuthDeg: number, elevationDeg: number): Vector3 {
  const azimuth = toRadians(azimuthDeg);
  const elevation = toRadians(elevationDeg);
  const horizontal = distanceM * Math.cos(elevation);
  return add(centre, {
    x: horizontal * Math.sin(azimuth),
    y: distanceM * Math.sin(elevation),
    z: horizontal * Math.cos(azimuth),
  });
}

/** The azimuth and elevation in degrees of `point` seen from `centre`, the inverse of sphericalPoint. */
export function sphericalAngles(centre: Vector3, point: Vector3): AnglePlacement {
  const offset = subtract(point, centre);
  const radius = length(offset);
  if (radius === 0) return { azimuthDeg: 0, elevationDeg: 0 };
  const elevationDeg = (Math.asin(Math.max(-1, Math.min(1, offset.y / radius))) * 180) / Math.PI;
  const azimuthDeg = offset.x === 0 && offset.z === 0 ? 0 : (Math.atan2(offset.x, offset.z) * 180) / Math.PI;
  return { azimuthDeg, elevationDeg };
}

/**
 * The base pose for a shot: the camera on the sphere of radius `distanceM`
 * around the anchor at the angle's azimuth and elevation, looking at the
 * anchor, rolled by `dutchDegrees` (0 for a level horizon). For `ground`
 * the camera and its target drop to the subject's bottom face
 * (anchor.y − subjectHeightM / 2) so the camera stays level.
 */
export function placeCamera(anchor: Vector3, distanceM: number, angle: CameraAngle, dutchDegrees: number, subjectHeightM: number): BasePose {
  const placement = anglePlacement(angle);
  const target = angle === 'ground' ? { x: anchor.x, y: anchor.y - subjectHeightM / 2, z: anchor.z } : anchor;
  const position = sphericalPoint(target, distanceM, placement.azimuthDeg, placement.elevationDeg);
  return { position, target, rollDeg: dutchDegrees, distanceM };
}

/** The orthonormal camera axes in world space for a view from `position` toward `target` before any roll. */
export interface ViewBasis {
  /** The view direction, local -Z. */
  readonly forward: Vector3;
  /** The camera's right, local +X. */
  readonly right: Vector3;
  /** The camera's up, local +Y. */
  readonly up: Vector3;
}

/**
 * The camera axes of a look-at: forward toward the target, right = forward ×
 * worldUp, up = right × forward. A view straight up or down has no
 * horizontal right, so it uses `degenerateReference` (by default -Z world)
 * as its up reference, which is the continuous limit of tilting an
 * eye-level camera from the +Z side down to overhead.
 */
export function viewBasis(position: Vector3, target: Vector3, degenerateReference: Vector3 = overheadUpReference): ViewBasis {
  const forward = normalize(subtract(target, position));
  const horizontalRight = cross(forward, worldUp);
  const reference = length(horizontalRight) < degenerateUpEpsilon ? degenerateReference : worldUp;
  const right = normalize(cross(forward, reference));
  const up = cross(right, forward);
  return { forward, right, up };
}

/**
 * The orientation of a camera at `position` looking at `target` with its
 * local -Z on the view direction and local +Y up, then rolled by `rollDeg`
 * about the view axis: a positive roll turns the camera counter-clockwise
 * seen from behind it, so the horizon in the picture tilts clockwise
 * (the right side drops), matching the shot spec's dutchDegrees sign.
 * `degenerateReference` is the up reference of a straight-down view.
 */
export function lookAtQuaternion(position: Vector3, target: Vector3, rollDeg: number, degenerateReference: Vector3 = overheadUpReference): Quaternion {
  const basis = viewBasis(position, target, degenerateReference);
  const lookAt = fromBasis(basis.right, basis.up, scale(basis.forward, -1));
  if (rollDeg === 0) return lookAt;
  const roll = fromAxisAngle({ x: 0, y: 0, z: 1 }, toRadians(rollDeg));
  return multiply(lookAt, roll);
}
