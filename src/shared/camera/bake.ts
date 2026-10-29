/**
 * Bakes a shot's camera move into per-frame camera frames (ADR 0008). Every
 * frame is a pure function of the shot, the render spec, the base pose and
 * the frame number: bake() is cameraFrameAt() called once per frame, so a
 * lane that evaluates one frame gets exactly the entry the bake holds.
 *
 * The move window is [startFrame, endFrame) with endFrame null meaning the
 * shot's end. Progress at frame k is (k − startFrame) / (endFrame −
 * startFrame), the frame's start time over the window's length, so frame
 * endFrame is the first frame of the end pose and a looping arc over a
 * whole shot does not repeat its first frame at the seam. The camera holds
 * its start pose before the window and its end pose after it.
 */
import type { EasingToken, Shot } from '../contracts/shot-spec.ts';
import { frameToSeconds } from '../frame-time.ts';
import { ease } from '../motion/easing.ts';
import { lookAtQuaternion } from './placement.ts';
import { movedPose } from './pose-moves.ts';
import type { BasePose, CameraFrame, RenderSpec } from './types.ts';

/** The frames a move occupies: [startFrame, endFrame). */
export interface MoveWindow {
  readonly startFrame: number;
  readonly endFrame: number;
}

/** The move's window with a null endFrame resolved to the shot's end. */
export function moveWindow(shot: Shot): MoveWindow {
  return { startFrame: shot.move.startFrame, endFrame: shot.move.endFrame ?? shot.durationFrames };
}

/**
 * The linear fraction of the move window at a frame, clamped: 0 before the
 * window, 1 at and after endFrame; a window of no length is complete at its
 * start frame.
 */
export function windowFraction(shot: Shot, frame: number): number {
  const window = moveWindow(shot);
  const frames = window.endFrame - window.startFrame;
  if (frames <= 0) return frame < window.startFrame ? 0 : 1;
  const fraction = (frame - window.startFrame) / frames;
  return fraction <= 0 ? 0 : fraction >= 1 ? 1 : fraction;
}

/** The easing the bake applies: the shot's own token, except the turntable, which is linear by definition. */
export function effectiveEasing(shot: Shot): EasingToken {
  return shot.move.preset === 'turntable' ? 'linear' : shot.move.easing;
}

/** The eased progress of the move at a frame: 0 before the window, the easing of the window fraction inside it, 1 after it. */
export function moveProgress(shot: Shot, frame: number): number {
  return ease(effectiveEasing(shot), windowFraction(shot, frame));
}

/**
 * The resolved camera of one frame: the moved pose turned into a position,
 * a look-at orientation with roll, the lens of the frame and the lane
 * channels (subject rotation, key light orbit, stage offset). Exposure is
 * the shot's offset; f-stop and shutter angle come from the lens.
 */
export function cameraFrameAt(shot: Shot, spec: RenderSpec, base: BasePose, frame: number): CameraFrame {
  const pose = movedPose(shot, base, {
    progress: moveProgress(shot, frame),
    fraction: windowFraction(shot, frame),
    seconds: frameToSeconds(frame, spec.fps),
  });
  return {
    frame,
    position: pose.position,
    rotation: lookAtQuaternion(pose.position, pose.target, pose.rollDeg, pose.degenerateUpReference),
    focalMm: pose.focalMm,
    fStop: shot.lens.fStop,
    focusDistanceM: pose.focusDistanceM,
    shutterAngleDeg: shot.lens.shutterAngleDeg,
    exposureEv: shot.exposureOffsetEv,
    subjectRotationDeg: pose.subjectRotationDeg,
    keyLightOrbitDeg: pose.keyLightOrbitDeg,
    stageOffset: pose.stageOffset,
  };
}

/** Every frame of the shot, frame 0 to durationFrames − 1, each equal to cameraFrameAt for that frame. */
export function bake(shot: Shot, spec: RenderSpec, base: BasePose): readonly CameraFrame[] {
  const frames: CameraFrame[] = [];
  for (let frame = 0; frame < shot.durationFrames; frame += 1) frames.push(cameraFrameAt(shot, spec, base, frame));
  return frames;
}
