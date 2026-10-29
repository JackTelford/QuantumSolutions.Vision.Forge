import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bake, cameraFrameAt } from '../../../src/shared/camera/bake.ts';
import { cameraMoves, handheldNoiseHz, handheldPositionCap } from '../../../src/shared/camera/moves.ts';
import { sphericalAngles } from '../../../src/shared/camera/placement.ts';
import { handheldRampFraction } from '../../../src/shared/camera/pose-moves.ts';
import { project, projectBox } from '../../../src/shared/camera/project.ts';
import { rotateVector } from '../../../src/shared/camera/quaternion.ts';
import type { BasePose, CameraFrame, Vector3 } from '../../../src/shared/camera/types.ts';
import { distance, dot, vector3 } from '../../../src/shared/camera/vector.ts';
import { CameraMoveValues } from '../../../src/shared/contracts/shot-spec.ts';
import type { CameraMove, EasingToken, Move, Shot } from '../../../src/shared/contracts/shot-spec.ts';
import { easingFunction } from '../../../src/shared/motion/easing.ts';
import {
  anchor,
  aspect,
  assertClose,
  assertVectorClose,
  basePoseFor,
  bottleBounds,
  frameAt,
  heroDistanceM,
  heroFocalMm,
  heroLens,
  numberAt,
  renderSpec,
  shotWithMove,
} from './fixtures.ts';

const epsilon = 1e-9;
/** Every test move runs over frames 0 to 49 of a 60-frame shot, so frame 50 holds the finished pose. */
const window = { startFrame: 0, endFrame: 50 };
const windowFrames = window.endFrame - window.startFrame;
/** The rack-focus test shots focus on a second point 1.5 m away instead of the solved distance. */
const rackFocusLens = { ...heroLens, focusDistanceM: 1.5 };

/** The hero shot with the move over the test window; rack-focus gets its second focus point. */
function shotFor(preset: CameraMove, move: Partial<Omit<Move, 'preset'>> = {}, changes: Partial<Shot> = {}): Shot {
  return shotWithMove(preset, { ...window, ...move }, { ...(preset === 'rack-focus' ? { lens: rackFocusLens } : {}), ...changes });
}

function forwardOf(frame: CameraFrame): Vector3 {
  return rotateVector(frame.rotation, vector3(0, 0, -1));
}

function upOf(frame: CameraFrame): Vector3 {
  return rotateVector(frame.rotation, vector3(0, 1, 0));
}

/** The angle between two unit vectors in radians. */
function angleBetween(a: Vector3, b: Vector3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

/** A scalar measure of how much the camera state changes between two frames: metres, radians and fractions summed. */
function poseDistance(a: CameraFrame, b: CameraFrame): number {
  return (
    distance(a.position, b.position) +
    Math.abs(a.focalMm - b.focalMm) / 100 +
    Math.abs(a.focusDistanceM - b.focusDistanceM) +
    angleBetween(forwardOf(a), forwardOf(b)) +
    angleBetween(upOf(a), upOf(b)) +
    Math.abs(a.subjectRotationDeg - b.subjectRotationDeg) / 90 +
    Math.abs(a.keyLightOrbitDeg - b.keyLightOrbitDeg) / 90 +
    Math.abs(a.stageOffset.x - b.stageOffset.x) +
    Math.abs(a.stageOffset.y - b.stageOffset.y)
  );
}

/** The frame-to-frame state changes over the move window, including the step onto the held end pose. */
function windowSteps(preset: CameraMove): number[] {
  const shot = shotFor(preset);
  const frames = bake(shot, renderSpec, basePoseFor(shot));
  const steps: number[] = [];
  for (let k = window.startFrame; k < window.endFrame; k += 1) steps.push(poseDistance(frameAt(frames, k), frameAt(frames, k + 1)));
  return steps;
}

/** The steepest slope of an easing curve, sampled finely; the largest change any frame can make is this times the mean. */
function maxEasingSlope(token: EasingToken): number {
  const curve = easingFunction(token);
  const samples = 20000;
  let steepest = 0;
  for (let i = 0; i < samples; i += 1) steepest = Math.max(steepest, (curve((i + 1) / samples) - curve(i / samples)) * samples);
  return steepest;
}

interface MoveEnds {
  readonly start: CameraFrame;
  readonly end: CameraFrame;
  readonly base: BasePose;
}

function moveEnds(preset: CameraMove, amplitude = 1): MoveEnds {
  const shot = shotFor(preset, { amplitude });
  const base = basePoseFor(shot);
  return { start: cameraFrameAt(shot, renderSpec, base, 0), end: cameraFrameAt(shot, renderSpec, base, window.endFrame), base };
}

describe('every move', () => {
  const settling = CameraMoveValues.filter((move) => !cameraMoves[move].endsAtCut && move !== 'turntable' && move !== 'static-hold' && move !== 'handheld');
  /** emphasized-decelerate departs at full speed by its definition (cubic-bezier(0.05, 0.7, 0.1, 1)), so these two settle only at the end. */
  const fastStarters: readonly CameraMove[] = ['crane-reveal', 'top-down-reveal'];

  it('settles to zero velocity at the end of its window, and starts from rest unless its easing departs fast', () => {
    for (const preset of settling) {
      const steps = windowSteps(preset);
      const largest = Math.max(...steps);
      const first = numberAt(steps, 0);
      const last = numberAt(steps, steps.length - 1);
      assert.ok(largest > 0, `${preset} moves`);
      assert.ok(last <= 0.1 * largest, `${preset} ends at rest: last step ${last} of ${largest}`);
      if (!fastStarters.includes(preset)) assert.ok(first <= 0.1 * largest, `${preset} starts at rest: first step ${first} of ${largest}`);
    }
  });

  it('accelerates into the cut for whip-pan and crash-zoom and runs at constant speed for the turntable', () => {
    for (const preset of ['whip-pan', 'crash-zoom'] as const) {
      const steps = windowSteps(preset);
      const last = numberAt(steps, steps.length - 1);
      assert.ok(last >= 0.5 * Math.max(...steps), `${preset} is still fast at the cut`);
      assert.ok(numberAt(steps, 0) < last, `${preset} speeds up`);
    }
    const turntable = windowSteps('turntable');
    for (const step of turntable) assertClose(step, numberAt(turntable, 0), epsilon, 'turntable step');
  });

  it('never jumps more between two frames than the easing\'s steepest slope allows', () => {
    const margin = 1.05;
    /** zoom-out divides the focal length by (1 + 0.5p), whose rate at p = 0 is 1.5 times its mean over the window. */
    const rateRatios: Partial<Record<CameraMove, number>> = { 'zoom-out': 1.5, breathe: Math.PI / 2 };
    for (const preset of CameraMoveValues) {
      if (preset === 'handheld') continue;
      const steps = windowSteps(preset);
      const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
      const slope = preset === 'breathe' ? 1 : maxEasingSlope(shotFor(preset).move.easing);
      const bound = mean * slope * (rateRatios[preset] ?? 1) * margin + epsilon;
      assert.ok(Math.max(...steps) <= bound, `${preset}: max ${Math.max(...steps)} vs mean ${mean} × slope ${slope}`);
    }
  });

  it('scales its travel with the amplitude', () => {
    const full = moveEnds('push-in', 1);
    const half = moveEnds('push-in', 0.5);
    assertClose(distance(full.end.position, full.base.target), heroDistanceM * (1 - 0.15), epsilon, 'full push');
    assertClose(distance(half.end.position, half.base.target), heroDistanceM * (1 - 0.075), epsilon, 'half push');
  });
});

describe('dollies and slides', () => {
  it('push-in and pull-out move along the view axis by 15 percent of the distance and pull the focus plane with them', () => {
    const pushed = moveEnds('push-in');
    const pulled = moveEnds('pull-out');
    assertClose(distance(pushed.end.position, anchor), heroDistanceM * 0.85, epsilon, 'push distance');
    assertClose(distance(pulled.end.position, anchor), heroDistanceM * 1.15, epsilon, 'pull distance');
    assertClose(pushed.end.focusDistanceM, heroLens.focusDistanceM - 0.15 * heroDistanceM, epsilon, 'focus follows the push');
    const centre = project(anchor, pushed.end, aspect);
    assert.ok(centre !== null);
    assertClose(centre.x, 0.5, 1e-6, 'anchor stays centred');
  });

  it('breathe drifts toward the subject by 0.5 percent at the middle of the window and is back at both ends', () => {
    const shot = shotFor('breathe');
    const base = basePoseFor(shot);
    assertVectorClose(cameraFrameAt(shot, renderSpec, base, 0).position, base.position, epsilon, 'start');
    assertClose(distance(cameraFrameAt(shot, renderSpec, base, 25).position, anchor), heroDistanceM * 0.995, epsilon, 'middle');
    assertVectorClose(cameraFrameAt(shot, renderSpec, base, 50).position, base.position, epsilon, 'end');
  });

  it('truck-right slides camera and target to the camera\'s right by 10 percent of the subject width so the anchor shifts left', () => {
    const { end } = moveEnds('truck-right');
    const slideM = 0.1 * bottleBounds.w;
    assertVectorClose(end.position, vector3(slideM, 0, heroDistanceM), epsilon, 'position');
    const centre = project(anchor, end, aspect);
    assert.ok(centre !== null);
    assertClose(centre.x, 0.5 - (heroFocalMm * slideM) / (heroDistanceM * 36), 1e-6, 'anchor shifted left');
    assertClose(centre.y, 0.5, 1e-6, 'anchor level');
    assertClose(moveEnds('truck-left').end.position.x, -slideM, epsilon, 'truck-left');
  });

  it('pedestal-up rises along the camera up axis by 10 percent of the subject height; the view stays level', () => {
    const { start, end } = moveEnds('pedestal-up');
    assertVectorClose(end.position, vector3(0, 0.1 * bottleBounds.h, heroDistanceM), epsilon, 'position');
    assertVectorClose(forwardOf(end), forwardOf(start), epsilon, 'still level');
    assertClose(moveEnds('pedestal-down').end.position.y, -0.1 * bottleBounds.h, epsilon, 'pedestal-down');
  });

  it('crane-reveal rises 12 percent of the subject height along world up and tilts down to keep the anchor centred', () => {
    const { end } = moveEnds('crane-reveal');
    assertClose(end.position.y, 0.12 * bottleBounds.h, epsilon, 'height');
    assert.ok(forwardOf(end).y < 0, 'tilted down');
    const centre = project(anchor, end, aspect);
    assert.ok(centre !== null);
    assertClose(centre.x, 0.5, 1e-6, 'anchor x');
    assertClose(centre.y, 0.5, 1e-6, 'anchor y');
  });
});

describe('rotations', () => {
  it('pan-right turns the view 10 degrees to the right so the anchor slides left; the position holds', () => {
    const { start, end, base } = moveEnds('pan-right');
    assert.deepEqual(end.position, base.position);
    assertClose(angleBetween(forwardOf(start), forwardOf(end)), (10 * Math.PI) / 180, epsilon, 'angle');
    const centre = project(anchor, end, aspect);
    assert.ok(centre !== null);
    assert.ok(centre.x < 0.5, `anchor slid left: ${centre.x}`);
    const left = project(anchor, moveEnds('pan-left').end, aspect);
    assert.ok(left !== null && left.x > 0.5, 'pan-left slides the anchor right');
  });

  it('tilt-up turns the view 10 degrees up so the anchor drops in the frame', () => {
    const { start, end } = moveEnds('tilt-up');
    assertClose(angleBetween(forwardOf(start), forwardOf(end)), (10 * Math.PI) / 180, epsilon, 'angle');
    assert.ok(forwardOf(end).y > 0, 'looking up');
    const centre = project(anchor, end, aspect);
    assert.ok(centre !== null && centre.y > 0.5, 'anchor dropped');
    assert.ok(forwardOf(moveEnds('tilt-down').end).y < 0, 'tilt-down looks down');
  });

  it('whip-pan turns 45 degrees to the right by the cut', () => {
    const { start, end } = moveEnds('whip-pan');
    assertClose(angleBetween(forwardOf(start), forwardOf(end)), (45 * Math.PI) / 180, epsilon, 'angle');
    assert.ok(forwardOf(end).x > 0, 'turned right');
  });

  it('arc orbits 60 degrees about world up at a constant distance, looking at the target throughout', () => {
    for (const [preset, azimuth] of [['arc-right', 60], ['arc-left', -60]] as const) {
      const shot = shotFor(preset);
      const base = basePoseFor(shot);
      for (const frame of bake(shot, renderSpec, base)) {
        assertClose(distance(frame.position, base.target), base.distanceM, 1e-6, `${preset} distance at ${frame.frame}`);
        const centre = project(base.target, frame, aspect);
        assert.ok(centre !== null);
        assertClose(centre.x, 0.5, 1e-6, `${preset} looks at the target at ${frame.frame}`);
      }
      assertClose(sphericalAngles(base.target, cameraFrameAt(shot, renderSpec, base, 50).position).azimuthDeg, azimuth, epsilon, `${preset} azimuth`);
    }
  });

  it('top-down-reveal starts straight overhead with -Z at the top of the picture and ends on the base pose at constant distance', () => {
    const shot = shotFor('top-down-reveal');
    const base = basePoseFor(shot);
    const frames = bake(shot, renderSpec, base);
    assertVectorClose(frameAt(frames, 0).position, vector3(0, heroDistanceM, 0), epsilon, 'overhead start');
    assertVectorClose(upOf(frameAt(frames, 0)), vector3(0, 0, -1), epsilon, 'overhead up');
    assertVectorClose(frameAt(frames, 50).position, base.position, epsilon, 'end on the base pose');
    for (const frame of frames) assertClose(distance(frame.position, base.target), base.distanceM, 1e-6, `distance at ${frame.frame}`);
    const halfAmplitude = shotFor('top-down-reveal', { amplitude: 0.5 });
    assertClose(sphericalAngles(base.target, cameraFrameAt(halfAmplitude, renderSpec, base, 0).position).elevationDeg, 45, epsilon, 'half amplitude starts half way up');
  });
});

describe('lens moves', () => {
  it('zoom-in grows the focal length 1.5 times, zoom-out shrinks it, crash-zoom doubles it, all with the camera held', () => {
    assertClose(moveEnds('zoom-in').end.focalMm, heroFocalMm * 1.5, epsilon, 'zoom-in');
    assertClose(moveEnds('zoom-out').end.focalMm, heroFocalMm / 1.5, epsilon, 'zoom-out');
    assertClose(moveEnds('crash-zoom').end.focalMm, heroFocalMm * 2, epsilon, 'crash-zoom');
    for (const preset of ['zoom-in', 'zoom-out', 'crash-zoom'] as const) {
      const ends = moveEnds(preset);
      assert.deepEqual(ends.end.position, ends.base.position, preset);
    }
  });

  it('dolly-zoom holds the projected height of the anchor plane exactly, the whole box within a percent, while the focal length grows 1.5 times', () => {
    const shot = shotFor('dolly-zoom');
    const base = basePoseFor(shot);
    const frames = bake(shot, renderSpec, base);
    const planeHeight = (frame: CameraFrame): number => {
      const top = project(vector3(0, bottleBounds.h / 2, 0), frame, aspect);
      const bottom = project(vector3(0, -bottleBounds.h / 2, 0), frame, aspect);
      assert.ok(top !== null && bottom !== null);
      return bottom.y - top.y;
    };
    const referencePlane = planeHeight(frameAt(frames, 0));
    const referenceBox = projectBox(bottleBounds, anchor, frameAt(frames, 0), aspect);
    assert.ok(referenceBox !== null);
    for (const frame of frames) {
      assert.ok(Math.abs(planeHeight(frame) - referencePlane) / referencePlane <= 0.005, `anchor plane height at ${frame.frame}`);
      const box = projectBox(bottleBounds, anchor, frame, aspect);
      assert.ok(box !== null);
      assert.ok(Math.abs(box.h - referenceBox.h) / referenceBox.h <= 0.01, `box height at ${frame.frame}: ${box.h} vs ${referenceBox.h}`);
    }
    assertClose(frameAt(frames, 50).focalMm, heroFocalMm * 1.5, epsilon, 'focal');
    assertClose(distance(frameAt(frames, 50).position, anchor), heroDistanceM * 1.5, epsilon, 'distance');
  });

  it('rack-focus travels the focus plane from the base distance to the lens focus distance and moves nothing else', () => {
    const shot = shotFor('rack-focus');
    const base = basePoseFor(shot);
    const frames = bake(shot, renderSpec, base);
    assertClose(frameAt(frames, 0).focusDistanceM, base.distanceM, epsilon, 'start');
    assertClose(frameAt(frames, 50).focusDistanceM, 1.5, epsilon, 'end');
    const middle = frameAt(frames, 25).focusDistanceM;
    assert.ok(middle > 1.5 && middle < base.distanceM, 'between');
    for (const frame of frames) {
      assert.deepEqual(frame.position, base.position, `position at ${frame.frame}`);
      assert.deepEqual(frame.rotation, frameAt(frames, 0).rotation, `rotation at ${frame.frame}`);
    }
  });
});

describe('lane channels', () => {
  it('turntable rotates the subject linearly to 40 degrees with the camera held, whatever easing the shot names', () => {
    const shot = shotFor('turntable', { easing: 'emphasized' });
    const base = basePoseFor(shot);
    const frames = bake(shot, renderSpec, base);
    for (let k = 0; k <= 50; k += 1) assertClose(frameAt(frames, k).subjectRotationDeg, (40 * k) / windowFrames, epsilon, `frame ${k}`);
    for (const frame of frames) assert.deepEqual(frame.position, base.position);
  });

  it('light-sweep orbits the key light to 90 degrees and parallax-drift slides the stage 6 percent, scaled by amplitude', () => {
    assertClose(moveEnds('light-sweep').end.keyLightOrbitDeg, 90, epsilon, 'light');
    assertClose(moveEnds('light-sweep', 0.5).end.keyLightOrbitDeg, 45, epsilon, 'half light');
    assert.deepEqual(moveEnds('parallax-drift').end.stageOffset, { x: 0.06, y: 0 });
    assertClose(moveEnds('parallax-drift', 0.5).end.stageOffset.x, 0.03, epsilon, 'half drift');
    const sweep = moveEnds('light-sweep');
    assert.deepEqual(sweep.end.position, sweep.base.position);
  });

  it('top-down-reveal on an overhead shot is a no-op: the pole is already the base pose, so the validator must re-angle it', () => {
    const shot = shotFor('top-down-reveal', {}, { angle: 'overhead' });
    const base = basePoseFor(shot);
    for (const frame of bake(shot, renderSpec, base)) assertVectorClose(frame.position, base.position, epsilon, `frame ${frame.frame}`);
  });
});

describe('handheld', () => {
  it('gives the same frames for the same seed and different frames for a different seed', () => {
    const shot = shotWithMove('handheld');
    const base = basePoseFor(shot);
    assert.deepEqual(bake(shot, renderSpec, base), bake(shot, renderSpec, base));
    const other = bake(shotWithMove('handheld', {}, { seed: 8 }), renderSpec, base);
    const same = bake(shot, renderSpec, base);
    assert.ok(same.some((frame, k) => distance(frame.position, frameAt(other, k).position) > 0), 'a different seed shakes differently');
  });

  it('starts at rest on the base pose, stays inside its caps and never steps farther than the noise and ramp slopes allow', () => {
    const shot = shotWithMove('handheld');
    const base = basePoseFor(shot);
    const frames = bake(shot, renderSpec, base);
    assert.deepEqual(frameAt(frames, 0).position, base.position);
    /** The caps of camera-moves.md bound the summed offset and the summed pitch-and-yaw view change, not each channel. */
    const positionCapM = handheldPositionCap * base.distanceM;
    const rotationCapRad = (0.5 * Math.PI) / 180;
    /** Cosine interpolation of a full swing moves at most π per sample; the ramp adds π/2 over its frames; three channels of cap/√3 sum to the cap. */
    const noiseSlope = Math.PI * (handheldNoiseHz / renderSpec.fps);
    const rampSlope = Math.PI / 2 / (handheldRampFraction * shot.durationFrames);
    const stepBound = positionCapM * (noiseSlope + rampSlope);
    let shaken = 0;
    for (const frame of frames) {
      const offset = distance(frame.position, base.position);
      assert.ok(offset <= positionCapM + epsilon, `offset ${offset} at ${frame.frame}`);
      assert.ok(angleBetween(forwardOf(frame), forwardOf(frameAt(frames, 0))) <= rotationCapRad + epsilon, `rotation at ${frame.frame}`);
      if (offset > 0) shaken += 1;
      if (frame.frame > 0) assert.ok(distance(frame.position, frameAt(frames, frame.frame - 1).position) <= stepBound, `step at ${frame.frame}`);
    }
    assert.ok(shaken > frames.length / 2, 'most frames shake');
  });
});
