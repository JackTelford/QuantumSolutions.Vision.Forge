/**
 * The camera between two baked frames, for motion blur by sub-frame
 * accumulation (ADR 0008 decision 1). The page only has the spec's bake,
 * one CameraFrame per integer frame and no base pose to re-bake from, so
 * sub-frame i of N samples the shutter window at frame + (i / N) ·
 * (shutterAngle / 360) by interpolating camera[frame] and camera[frame + 1]:
 * linearly for the position, the lens and the lane angles, by slerp for
 * the rotation. The last frame of a shot has no successor and holds.
 */
import type { CameraFrame, Quaternion, Vector3 } from '../camera/types.ts';

/** a + (b - a) · t. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVector(a: Vector3, b: Vector3, t: number): Vector3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Below this cosine of the half angle the two rotations are taken as equal and blended linearly (the slerp's sine would divide by nearly zero). */
const slerpLinearThreshold = 0.9995;

/**
 * Spherical linear interpolation of two unit quaternions along the
 * shorter arc: b is negated when the dot product is negative (q and -q are
 * the same rotation), and two rotations closer than a fraction of a degree
 * are blended linearly and renormalised.
 */
export function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let end = b;
  if (dot < 0) {
    dot = -dot;
    end = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (dot > slerpLinearThreshold) {
    const x = lerp(a.x, end.x, t);
    const y = lerp(a.y, end.y, t);
    const z = lerp(a.z, end.z, t);
    const w = lerp(a.w, end.w, t);
    const magnitude = Math.sqrt(x * x + y * y + z * z + w * w);
    return { x: x / magnitude, y: y / magnitude, z: z / magnitude, w: w / magnitude };
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const weightA = Math.sin((1 - t) * theta) / sinTheta;
  const weightB = Math.sin(t * theta) / sinTheta;
  return {
    x: a.x * weightA + end.x * weightB,
    y: a.y * weightA + end.y * weightB,
    z: a.z * weightA + end.z * weightB,
    w: a.w * weightA + end.w * weightB,
  };
}

/** The fractional frame offsets of the sub-frames of one frame: i / count of the shutter's share of the frame interval, for i from 0. */
export function subFrameOffsets(shutterAngleDeg: number, count: number): readonly number[] {
  const window = shutterAngleDeg / 360;
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) offsets.push((index / count) * window);
  return offsets;
}

/**
 * The camera at `frame + offset` for an offset in [0, 1): camera[frame]
 * itself at offset 0 or when the next frame does not exist (the shot's
 * last frame holds), else the interpolation toward camera[frame + 1]. The
 * frame number and the shutter angle are those of the integer frame.
 * Throws when the frame has no baked camera.
 */
export function subFrameCamera(camera: readonly CameraFrame[], frame: number, offset: number): CameraFrame {
  const at = camera[frame];
  if (at === undefined) throw new Error(`Frame ${String(frame)} has no baked camera; the shot has ${String(camera.length)} frames.`);
  const next = camera[frame + 1];
  if (offset === 0 || next === undefined) return at;
  return {
    frame: at.frame,
    position: lerpVector(at.position, next.position, offset),
    rotation: slerp(at.rotation, next.rotation, offset),
    focalMm: lerp(at.focalMm, next.focalMm, offset),
    fStop: lerp(at.fStop, next.fStop, offset),
    focusDistanceM: lerp(at.focusDistanceM, next.focusDistanceM, offset),
    shutterAngleDeg: at.shutterAngleDeg,
    exposureEv: lerp(at.exposureEv, next.exposureEv, offset),
    subjectRotationDeg: lerp(at.subjectRotationDeg, next.subjectRotationDeg, offset),
    keyLightOrbitDeg: lerp(at.keyLightOrbitDeg, next.keyLightOrbitDeg, offset),
    stageOffset: { x: lerp(at.stageOffset.x, next.stageOffset.x, offset), y: lerp(at.stageOffset.y, next.stageOffset.y, offset) },
  };
}
