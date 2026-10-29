/**
 * How the three lane reads a baked CameraFrame (ADR 0008 decision 1): the
 * camera's world position and quaternion as they are (three's camera looks
 * down its local -Z with +Y up, the same convention as camera/types.ts),
 * the vertical field of view of a 36 mm film gauge at the frame's focal
 * length, and a fixed near and far plane. The parallax-drift stage offset,
 * which the html lane slides its stage by, becomes a sideways camera shift
 * here. The projection below repeats three's view and perspective matrices
 * in plain numbers so a Node test can hold the mapping to camera/project.ts
 * without a WebGL context.
 */
import { multiplyMatrix4, rotationMatrix4, translationMatrix4 } from '../camera/css-transform.ts';
import type { Matrix4 } from '../camera/css-transform.ts';
import { toRadians, verticalFovDegrees } from '../camera/model.ts';
import { conjugate, rotateVector } from '../camera/quaternion.ts';
import type { CameraFrame, Quaternion, Vector3 } from '../camera/types.ts';
import { add, scale } from '../camera/vector.ts';
import type { BoundsM } from '../contracts/shot-spec.ts';

/** The nearest distance the camera draws, in metres; a macro lens at ECU still clears it. */
export const cameraNearM = 0.02;

/** The farthest distance the camera draws, in metres; the stage ends at 2.5 m behind the subject. */
export const cameraFarM = 100;

/** three's film gauge for a 36 mm sensor on the larger axis, matching model.ts (ADR 0008). */
export const filmGaugeMm = 36;

/** What the lane sets on its PerspectiveCamera for one (sub-)frame. */
export interface ThreeCameraPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  /** The focal length the camera is given through setFocalLength, in millimetres. */
  readonly focalMm: number;
  /** The vertical field of view in degrees that setFocalLength yields at this aspect; kept for the pure projection. */
  readonly fovDeg: number;
  readonly aspect: number;
  readonly nearM: number;
  readonly farM: number;
}

/**
 * The sideways shift of the camera for a stage offset: the html lane slides
 * its stage right by stageOffset.x of the frame width and down by
 * stageOffset.y of its height, which is what a camera moving left and up
 * shows, so the camera moves by -x subject widths along its right axis and
 * +y subject heights along its up axis. Subject sizes, not frame sizes,
 * keep the drift a small parallax rather than a reframing.
 */
export function stageOffsetShift(frame: CameraFrame, bounds: BoundsM): Vector3 {
  const right = rotateVector(frame.rotation, { x: 1, y: 0, z: 0 });
  const up = rotateVector(frame.rotation, { x: 0, y: 1, z: 0 });
  return add(scale(right, -frame.stageOffset.x * bounds.w), scale(up, frame.stageOffset.y * bounds.h));
}

/** The camera pose of a baked frame at an aspect ratio, with the stage offset applied as a sideways shift. */
export function threeCameraPose(frame: CameraFrame, aspect: number, bounds: BoundsM): ThreeCameraPose {
  return {
    position: add(frame.position, stageOffsetShift(frame, bounds)),
    quaternion: frame.rotation,
    focalMm: frame.focalMm,
    fovDeg: verticalFovDegrees(frame.focalMm, aspect),
    aspect,
    nearM: cameraNearM,
    farM: cameraFarM,
  };
}

/** The row-major view matrix of a pose: the inverse of its world transform, rotation by the conjugate after translating the camera to the origin. */
export function viewMatrix(pose: ThreeCameraPose): Matrix4 {
  return multiplyMatrix4(rotationMatrix4(conjugate(pose.quaternion)), translationMatrix4(-pose.position.x, -pose.position.y, -pose.position.z));
}

/**
 * The row-major perspective matrix three's PerspectiveCamera builds
 * (makePerspective over a symmetric frustum): top = near·tan(fov/2),
 * right = top·aspect, the usual OpenGL depth mapping into [-1, 1].
 */
export function perspectiveMatrix(pose: ThreeCameraPose): Matrix4 {
  const top = pose.nearM * Math.tan(toRadians(pose.fovDeg) / 2);
  const right = top * pose.aspect;
  const { nearM: near, farM: far } = pose;
  return [
    near / right, 0, 0, 0,
    0, near / top, 0, 0,
    0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near),
    0, 0, -1, 0,
  ];
}

/**
 * A world point through the pose's view and perspective matrices, as
 * fractions of the frame from the left and the top (0.5 at the centre),
 * the way project.ts reports them; null when the point is on or behind
 * the camera plane. Clip space is divided by w and the normalised device
 * y, which grows upward, is flipped into the frame's top-down y.
 */
export function projectThroughPose(point: Vector3, pose: ThreeCameraPose): { readonly x: number; readonly y: number } | null {
  const m = multiplyMatrix4(perspectiveMatrix(pose), viewMatrix(pose));
  const at = (index: number): number => m[index] ?? 0;
  const clipX = at(0) * point.x + at(1) * point.y + at(2) * point.z + at(3);
  const clipY = at(4) * point.x + at(5) * point.y + at(6) * point.z + at(7);
  const clipW = at(12) * point.x + at(13) * point.y + at(14) * point.z + at(15);
  if (clipW <= 0) return null;
  return { x: 0.5 + clipX / clipW / 2, y: 0.5 - clipY / clipW / 2 };
}
