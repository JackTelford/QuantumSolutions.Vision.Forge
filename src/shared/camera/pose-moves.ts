/**
 * What each move does to the base pose at one progress value. Every
 * function is a pure function of the shot, the base pose and the progress
 * numbers; bake.ts turns the result into a CameraFrame. Caps are the
 * catalogue's (moves.ts) scaled by the shot's amplitude.
 */
import type { Shot } from '../contracts/shot-spec.ts';
import { ease } from '../motion/easing.ts';
import { toRadians } from './model.ts';
import { cameraMoves, handheldNoiseHz, handheldRotationCapDeg } from './moves.ts';
import { noiseChannels, smoothNoise } from './noise.ts';
import { sphericalAngles, sphericalPoint, viewBasis } from './placement.ts';
import type { ViewBasis } from './placement.ts';
import { fromAxisAngle, rotateVector } from './quaternion.ts';
import type { BasePose, StageOffset, Vector3 } from './types.ts';
import { add, distance, normalize, overheadUpReference, scale, subtract, worldUp } from './vector.ts';

/** The camera state a move produces at one moment; the baker adds the lens constants and the orientation. */
export interface MovedPose {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly rollDeg: number;
  readonly focalMm: number;
  readonly focusDistanceM: number;
  readonly subjectRotationDeg: number;
  readonly keyLightOrbitDeg: number;
  readonly stageOffset: StageOffset;
  /** The up reference to use when the view is straight up or down, so a descent from overhead keeps its roll. */
  readonly degenerateUpReference: Vector3;
}

/** The progress numbers of one frame inside the move window. */
export interface MoveMoment {
  /** The eased progress, 0 before the window, 1 after it. */
  readonly progress: number;
  /** The linear window fraction, 0 before the window, 1 after it, for cycles and the turntable. */
  readonly fraction: number;
  /** Seconds since the start of the shot, for the handheld noise. */
  readonly seconds: number;
}

const noStageOffset: StageOffset = { x: 0, y: 0 };

/** The fraction of the handheld window over which the shake fades in, and again out, so the camera starts and ends at rest. */
export const handheldRampFraction = 0.15;

/** Whip-pan turns toward the right, with reading direction (easing-grammar.md rule 5). */
const whipPanDirection = -1;

function unmoved(base: BasePose, shot: Shot): MovedPose {
  return {
    position: base.position,
    target: base.target,
    rollDeg: base.rollDeg,
    focalMm: shot.lens.focalMm,
    focusDistanceM: shot.lens.focusDistanceM,
    subjectRotationDeg: 0,
    keyLightOrbitDeg: 0,
    stageOffset: noStageOffset,
    degenerateUpReference: overheadUpReference,
  };
}

/** Moves the camera along the view axis by `metres` (positive toward the target); the target holds. */
function dolly(pose: MovedPose, basis: ViewBasis, metres: number): MovedPose {
  return { ...pose, position: add(pose.position, scale(basis.forward, metres)) };
}

/** Slides the camera and its target together along `axis` by `metres`: a parallax move that keeps the framing. */
function slide(pose: MovedPose, axis: Vector3, metres: number): MovedPose {
  const shift = scale(axis, metres);
  return { ...pose, position: add(pose.position, shift), target: add(pose.target, shift) };
}

/** Turns the view direction about `axis` through the camera position by `degrees` (right-hand rule); the position holds. */
function rotateView(pose: MovedPose, axis: Vector3, degrees: number): MovedPose {
  const rotation = fromAxisAngle(axis, toRadians(degrees));
  const toTarget = subtract(pose.target, pose.position);
  return { ...pose, target: add(pose.position, rotateVector(rotation, toTarget)) };
}

/** Orbits the camera about world +Y through the target by `degrees` (positive counter-clockwise seen from above, the camera's right). */
function orbit(pose: MovedPose, degrees: number): MovedPose {
  const rotation = fromAxisAngle(worldUp, toRadians(degrees));
  const fromTarget = subtract(pose.position, pose.target);
  return { ...pose, position: add(pose.target, rotateVector(rotation, fromTarget)) };
}

/** Moves the camera on the sphere around its target from the overhead pole down to the base elevation. */
function topDownReveal(pose: MovedPose, base: BasePose, amplitude: number, progress: number): MovedPose {
  const angles = sphericalAngles(base.target, base.position);
  const startElevation = angles.elevationDeg + (90 - angles.elevationDeg) * amplitude;
  const elevation = startElevation + (angles.elevationDeg - startElevation) * progress;
  const horizontal = sphericalPoint(base.target, 1, angles.azimuthDeg, 0);
  return {
    ...pose,
    position: sphericalPoint(base.target, base.distanceM, angles.azimuthDeg, elevation),
    degenerateUpReference: normalize(subtract(base.target, horizontal)),
  };
}

/** The handheld envelope: 0 at both ends of the window, 1 in the middle, sine-in-out over the ramps. */
export function handheldEnvelope(fraction: number): number {
  return ease('sine-in-out', Math.min(1, fraction / handheldRampFraction, (1 - fraction) / handheldRampFraction));
}

/**
 * Seeded shake: three position channels along the camera axes and pitch,
 * yaw and roll, each smooth noise scaled by its cap, the amplitude and the
 * envelope. The caps bound the summed offset, not each channel: three
 * perpendicular channels of amplitude a add up to at most a·√3 metres and
 * pitch plus yaw turn the view by at most a·√2 degrees, so the per-channel
 * amplitudes are the caps divided by √3 and √2. Roll is its own axis and
 * keeps the full rotation cap.
 */
function handheld(pose: MovedPose, basis: ViewBasis, base: BasePose, shot: Shot, moment: MoveMoment): MovedPose {
  const envelope = handheldEnvelope(moment.fraction);
  if (envelope === 0) return pose;
  const seed = shot.seed;
  const samplePosition = moment.seconds * handheldNoiseHz;
  const metres = (cameraMoves.handheld.cap * shot.move.amplitude * base.distanceM * envelope) / Math.sqrt(3);
  const degrees = (handheldRotationCapDeg * shot.move.amplitude * envelope) / Math.sqrt(2);
  const rollDegrees = handheldRotationCapDeg * shot.move.amplitude * envelope;
  const shake = add(
    add(scale(basis.right, metres * smoothNoise(seed, noiseChannels.positionRight, samplePosition)), scale(basis.up, metres * smoothNoise(seed, noiseChannels.positionUp, samplePosition))),
    scale(basis.forward, metres * smoothNoise(seed, noiseChannels.positionForward, samplePosition)),
  );
  const shifted = slide(pose, shake, 1);
  const pitched = rotateView(shifted, basis.right, degrees * smoothNoise(seed, noiseChannels.pitch, samplePosition));
  const yawed = rotateView(pitched, basis.up, degrees * smoothNoise(seed, noiseChannels.yaw, samplePosition));
  return { ...yawed, rollDeg: yawed.rollDeg + rollDegrees * smoothNoise(seed, noiseChannels.roll, samplePosition) };
}

/** The focus plane follows the camera's travel toward or away from the target, so the sharp surface stays the same one. */
function withTrackedFocus(pose: MovedPose, base: BasePose, shot: Shot): MovedPose {
  const travel = distance(pose.position, pose.target) - base.distanceM;
  return { ...pose, focusDistanceM: shot.lens.focusDistanceM + travel };
}

/**
 * The pose of the shot's move at one moment. The direction words are the
 * camera's: truck-right and arc-right travel toward the camera's right,
 * pan-right turns the view to the right, pedestal-up rises along the
 * camera's up axis, crane-reveal rises along world up. top-down-reveal
 * needs a non-overhead angle to travel: it descends from the pole to the
 * base elevation, so on an `overhead` shot every frame is the base pose.
 */
export function movedPose(shot: Shot, base: BasePose, moment: MoveMoment): MovedPose {
  const basis = viewBasis(base.position, base.target);
  const amplitude = shot.move.amplitude;
  const p = moment.progress;
  const pose = unmoved(base, shot);
  const cap = cameraMoves[shot.move.preset].cap;
  const width = shot.subject.boundsM.w;
  const height = shot.subject.boundsM.h;
  switch (shot.move.preset) {
    case 'static-hold':
      return pose;
    case 'breathe':
      return withTrackedFocus(dolly(pose, basis, cap * amplitude * base.distanceM * (1 - Math.cos(2 * Math.PI * moment.fraction)) / 2), base, shot);
    case 'push-in':
      return withTrackedFocus(dolly(pose, basis, cap * amplitude * base.distanceM * p), base, shot);
    case 'pull-out':
      return withTrackedFocus(dolly(pose, basis, -cap * amplitude * base.distanceM * p), base, shot);
    case 'truck-left':
      return slide(pose, basis.right, -cap * amplitude * width * p);
    case 'truck-right':
      return slide(pose, basis.right, cap * amplitude * width * p);
    case 'pedestal-up':
      return slide(pose, basis.up, cap * amplitude * height * p);
    case 'pedestal-down':
      return slide(pose, basis.up, -cap * amplitude * height * p);
    case 'pan-left':
      return rotateView(pose, basis.up, cap * amplitude * p);
    case 'pan-right':
      return rotateView(pose, basis.up, -cap * amplitude * p);
    case 'tilt-up':
      return rotateView(pose, basis.right, cap * amplitude * p);
    case 'tilt-down':
      return rotateView(pose, basis.right, -cap * amplitude * p);
    case 'arc-left':
      return orbit(pose, -cap * amplitude * p);
    case 'arc-right':
      return orbit(pose, cap * amplitude * p);
    case 'turntable':
      return { ...pose, subjectRotationDeg: cap * amplitude * moment.fraction };
    case 'crane-reveal':
      return withTrackedFocus({ ...pose, position: add(pose.position, scale(worldUp, cap * amplitude * height * p)) }, base, shot);
    case 'rack-focus':
      return { ...pose, focusDistanceM: base.distanceM + (shot.lens.focusDistanceM - base.distanceM) * p };
    case 'zoom-in':
      return { ...pose, focalMm: shot.lens.focalMm * (1 + (cap - 1) * amplitude * p) };
    case 'zoom-out':
      return { ...pose, focalMm: shot.lens.focalMm / (1 + (cap - 1) * amplitude * p) };
    case 'crash-zoom':
      return { ...pose, focalMm: shot.lens.focalMm * (1 + (cap - 1) * amplitude * p) };
    case 'dolly-zoom': {
      const growth = 1 + (cap - 1) * amplitude * p;
      const position = add(pose.target, scale(subtract(pose.position, pose.target), growth));
      return withTrackedFocus({ ...pose, position, focalMm: shot.lens.focalMm * growth }, base, shot);
    }
    case 'whip-pan':
      return rotateView(pose, basis.up, whipPanDirection * cap * amplitude * p);
    case 'handheld':
      return withTrackedFocus(handheld(pose, basis, base, shot, moment), base, shot);
    case 'parallax-drift':
      return { ...pose, stageOffset: { x: cap * amplitude * p, y: 0 } };
    case 'light-sweep':
      return { ...pose, keyLightOrbitDeg: cap * amplitude * p };
    case 'top-down-reveal':
      return topDownReveal(pose, base, amplitude, p);
  }
}
