/**
 * The camera section of a blender-scene document from the baked camera
 * (ADR 0008 decision 1): a 36 mm sensor with sensor_fit AUTO, the lens,
 * f-stop and focus distance per frame, and the pose mapped to Blender's
 * Z-up world through camera/blender-axes.ts. One keyframe per rendered
 * frame plus one past each end of the batch (keyframeFrames); the applier
 * sets linear interpolation, so Blender's motion blur sees the same
 * straight line between two baked frames that the three lane's sub-frame
 * interpolation draws. Pure.
 */
import { sensorLongEdgeMm } from '../../shared/camera/model.ts';
import type { CameraFrame } from '../../shared/camera/types.ts';
import type { BlenderScene, CameraKeyframe } from '../../shared/contracts/blender-scene.ts';
import { cameraFarM, cameraNearM } from '../../shared/three/camera-mapping.ts';
import { blenderPoint, blenderRotation } from './axes.ts';

/** The baked frame for a shot frame number; a frame the bake does not hold is a programming error named here. */
export function bakedFrame(camera: readonly CameraFrame[], frame: number): CameraFrame {
  const baked = camera[frame];
  if (baked === undefined || baked.frame !== frame) throw new RangeError(`The bake has no entry for frame ${String(frame)}; it holds ${String(camera.length)} frames.`);
  return baked;
}

/**
 * The frames every animated channel is keyframed at for a batch: the
 * batch's frames plus the bake's frame before the first and after the
 * last, when the bake holds them. Blender's motion blur with a centred
 * shutter samples a quarter frame past each end of a frame, and an F-curve
 * holds its value constant beyond its first and last key, so a batch
 * keyframed only inside itself would render its first and last frame with
 * half the blur and a still (one frame) with none, while the three lane's
 * still blurs over the bake. The output range stays the batch's own; the
 * extra keys only tell Blender where the motion goes.
 */
export function keyframeFrames(frames: readonly number[], camera: readonly CameraFrame[]): readonly number[] {
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first === undefined || last === undefined) throw new RangeError('A Blender scene renders at least one frame.');
  const keyed: number[] = [];
  if (first > 0) keyed.push(first - 1);
  keyed.push(...frames);
  if (last + 1 < camera.length) keyed.push(last + 1);
  return keyed;
}

/** One camera keyframe: the frame's position and orientation in Blender's axes, its lens, aperture and focus. */
export function cameraKeyframe(frame: CameraFrame): CameraKeyframe {
  return {
    frame: frame.frame,
    location: blenderPoint(frame.position),
    rotationQuaternion: blenderRotation(frame.rotation),
    lensMm: frame.focalMm,
    fStop: frame.fStop,
    focusDistanceM: frame.focusDistanceM,
  };
}

/** The camera section: the sensor and clip planes every shot shares, depth of field on, and one keyframe per frame to render plus the neighbour past each end (keyframeFrames). */
export function blenderCamera(camera: readonly CameraFrame[], frames: readonly number[]): BlenderScene['camera'] {
  return {
    sensorWidthMm: sensorLongEdgeMm,
    clipStartM: cameraNearM,
    clipEndM: cameraFarM,
    useDof: true,
    keyframes: keyframeFrames(frames, camera).map((frame) => cameraKeyframe(bakedFrame(camera, frame))),
  };
}
