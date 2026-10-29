/**
 * The pinhole projection of world points into the picture through a baked
 * camera frame: the inverse of the frame's rotation takes a point into
 * camera space, the focal length and the 36 mm sensor turn it into frame
 * fractions. The composition solver checks anchors and safe areas with it.
 */
import type { BoundsM } from '../contracts/shot-spec.ts';
import { sensorHeightMm, sensorWidthMm } from './model.ts';
import { conjugate, rotateVector } from './quaternion.ts';
import type { CameraFrame, FrameBox, ProjectedPoint, Vector3 } from './types.ts';
import { subtract } from './vector.ts';

/**
 * Projects a world point through the frame's camera: fractions of the frame
 * from the left (x) and the top (y), 0.5 at the centre, plus the depth
 * along the view axis in metres. Null when the point is on or behind the
 * camera plane. x = 0.5 + focal·cx / (depth·sensorWidth), with cx the
 * camera-space offset in metres and the sensor width in the same unit as
 * the focal length.
 */
export function project(point: Vector3, frame: CameraFrame, aspect: number): ProjectedPoint | null {
  const local = rotateVector(conjugate(frame.rotation), subtract(point, frame.position));
  const depth = -local.z;
  if (depth <= 0) return null;
  const x = 0.5 + (frame.focalMm * local.x) / (depth * sensorWidthMm(aspect));
  const y = 0.5 - (frame.focalMm * local.y) / (depth * sensorHeightMm(aspect));
  return { x, y, depth };
}

/** The eight corners of an axis-aligned box of size `bounds` (metres) centred on `anchor`. */
export function boxCorners(bounds: BoundsM, anchor: Vector3): readonly Vector3[] {
  const corners: Vector3[] = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        corners.push({ x: anchor.x + sx * bounds.w, y: anchor.y + sy * bounds.h, z: anchor.z + sz * bounds.d });
      }
    }
  }
  return corners;
}

/**
 * The 2D bounding box, in frame fractions, of the eight corners of an
 * axis-aligned box centred on `anchor`; null when any corner is behind the
 * camera, because a box that straddles the camera plane has no finite
 * picture.
 */
export function projectBox(bounds: BoundsM, anchor: Vector3, frame: CameraFrame, aspect: number): FrameBox | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const corner of boxCorners(bounds, anchor)) {
    const projected = project(corner, frame, aspect);
    if (projected === null) return null;
    left = Math.min(left, projected.x);
    right = Math.max(right, projected.x);
    top = Math.min(top, projected.y);
    bottom = Math.max(bottom, projected.y);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
