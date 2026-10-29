import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bake, cameraFrameAt, effectiveEasing, moveProgress, moveWindow, windowFraction } from '../../../src/shared/camera/bake.ts';
import type { CameraFrame } from '../../../src/shared/camera/types.ts';
import { ease } from '../../../src/shared/motion/easing.ts';
import { assertClose, basePoseFor, frameAt, makeShot, renderSpec, shotWithMove } from './fixtures.ts';

const epsilon = 1e-12;

/** The frame without its frame number, for comparing poses across frames. */
function poseOf(frame: CameraFrame): Omit<CameraFrame, 'frame'> {
  const { frame: _frame, ...pose } = frame;
  return pose;
}

describe('bake', () => {
  it('produces one frame per frame of the shot, numbered from 0', () => {
    const shot = shotWithMove('push-in');
    const frames = bake(shot, renderSpec, basePoseFor(shot));
    assert.equal(frames.length, shot.durationFrames);
    frames.forEach((frame, index) => assert.equal(frame.frame, index));
  });

  it('is frame-pure: bake(shot)[k] deep-equals cameraFrameAt(shot, k) for every move', () => {
    for (const preset of ['push-in', 'arc-right', 'handheld', 'dolly-zoom', 'top-down-reveal'] as const) {
      const shot = shotWithMove(preset, { startFrame: 5, endFrame: 40 });
      const base = basePoseFor(shot);
      const frames = bake(shot, renderSpec, base);
      for (let k = 0; k < shot.durationFrames; k += 1) assert.deepEqual(frames[k], cameraFrameAt(shot, renderSpec, base, k), `${preset} frame ${k}`);
    }
  });

  it('takes exposure from the shot and f-stop, shutter angle and focus from the lens on a static hold', () => {
    const shot = makeShot({ exposureOffsetEv: -0.5, lens: { focalMm: 50, fStop: 5.6, focusDistanceM: 1.7, shutterAngleDeg: 90 } });
    const frame = cameraFrameAt(shot, renderSpec, basePoseFor(shot), 12);
    assert.equal(frame.exposureEv, -0.5);
    assert.equal(frame.fStop, 5.6);
    assert.equal(frame.shutterAngleDeg, 90);
    assert.equal(frame.focalMm, 50);
    assert.equal(frame.focusDistanceM, 1.7);
    assert.equal(frame.subjectRotationDeg, 0);
    assert.equal(frame.keyLightOrbitDeg, 0);
    assert.deepEqual(frame.stageOffset, { x: 0, y: 0 });
  });

  it('holds every frame identical on a static hold with a unit rotation and the base position', () => {
    const shot = makeShot();
    const base = basePoseFor(shot);
    const frames = bake(shot, renderSpec, base);
    const first = poseOf(frameAt(frames, 0));
    for (const frame of frames) assert.deepEqual(poseOf(frame), first);
    assert.deepEqual(frameAt(frames, 0).position, base.position);
    const q = frameAt(frames, 0).rotation;
    assertClose(Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w), 1, epsilon, 'unit quaternion');
  });
});

describe('move window', () => {
  it('resolves a null endFrame to the shot end', () => {
    assert.deepEqual(moveWindow(makeShot({ durationFrames: 90 })), { startFrame: 0, endFrame: 90 });
    assert.deepEqual(moveWindow(shotWithMove('push-in', { startFrame: 10, endFrame: 40 })), { startFrame: 10, endFrame: 40 });
  });

  it('counts the window fraction from startFrame over the window length, clamped on both sides', () => {
    const shot = shotWithMove('push-in', { startFrame: 10, endFrame: 40 });
    assert.equal(windowFraction(shot, 0), 0);
    assert.equal(windowFraction(shot, 10), 0);
    assert.equal(windowFraction(shot, 25), 0.5);
    assert.equal(windowFraction(shot, 39), 29 / 30);
    assert.equal(windowFraction(shot, 40), 1);
    assert.equal(windowFraction(shot, 59), 1);
  });

  it('treats a window of no length as complete at its start frame', () => {
    const shot = shotWithMove('push-in', { startFrame: 10, endFrame: 10 });
    assert.equal(windowFraction(shot, 9), 0);
    assert.equal(windowFraction(shot, 10), 1);
  });

  it('eases the window fraction with the shot\'s token and is 0 before and 1 after the window', () => {
    const shot = shotWithMove('push-in', { startFrame: 10, endFrame: 40, easing: 'sine-in-out' });
    assert.equal(moveProgress(shot, 3), 0);
    assertClose(moveProgress(shot, 25), 0.5, epsilon, 'middle');
    assertClose(moveProgress(shot, 17), ease('sine-in-out', 7 / 30), epsilon, 'eased');
    assert.equal(moveProgress(shot, 40), 1);
    assert.equal(moveProgress(shot, 59), 1);
  });

  it('keeps the turntable linear whatever the shot says and uses the shot\'s token otherwise', () => {
    assert.equal(effectiveEasing(shotWithMove('turntable', { easing: 'emphasized' })), 'linear');
    assert.equal(effectiveEasing(shotWithMove('push-in', { easing: 'standard' })), 'standard');
  });

  it('holds the start pose before startFrame and the end pose from endFrame on', () => {
    const shot = shotWithMove('push-in', { startFrame: 10, endFrame: 40 });
    const base = basePoseFor(shot);
    const frames = bake(shot, renderSpec, base);
    const startPose = poseOf(frameAt(frames, 10));
    const endPose = poseOf(frameAt(frames, 40));
    for (let k = 0; k <= 10; k += 1) assert.deepEqual(poseOf(frameAt(frames, k)), startPose, `frame ${k} holds the start`);
    for (let k = 40; k < 60; k += 1) assert.deepEqual(poseOf(frameAt(frames, k)), endPose, `frame ${k} holds the end`);
    assert.deepEqual(frameAt(frames, 10).position, base.position);
    assert.notDeepEqual(frameAt(frames, 25).position, base.position);
  });

  it('is time-exact: a move over the whole shot reaches its end pose on frame durationFrames, one frame after the last rendered one', () => {
    const shot = shotWithMove('turntable', { easing: 'linear' });
    const base = basePoseFor(shot);
    const lastRendered = cameraFrameAt(shot, renderSpec, base, shot.durationFrames - 1);
    const endPose = cameraFrameAt(shot, renderSpec, base, shot.durationFrames);
    assert.equal(endPose.subjectRotationDeg, 40);
    assertClose(lastRendered.subjectRotationDeg, (40 * 59) / 60, epsilon, 'last rendered frame is 1/n short of the cap');
    assert.notEqual(lastRendered.subjectRotationDeg, endPose.subjectRotationDeg);
  });
});
