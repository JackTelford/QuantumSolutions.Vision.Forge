import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { frameToMilliseconds, frameToSeconds, secondsToFrames } from '../../src/shared/frame-time.ts';

describe('frame-time', () => {
  it('converts a frame index to seconds at the given rate', () => {
    assert.equal(frameToSeconds(0, 30), 0);
    assert.equal(frameToSeconds(30, 30), 1);
    assert.equal(frameToSeconds(15, 30), 0.5);
  });

  it('converts a frame index to the milliseconds the Web Animations API expects', () => {
    assert.equal(frameToMilliseconds(15, 30), 500);
    assert.equal(frameToMilliseconds(59, 30), 59000 / 30);
  });

  it('rounds seconds to the nearest whole frame', () => {
    assert.equal(secondsToFrames(1, 30), 30);
    assert.equal(secondsToFrames(0.5, 30), 15);
    assert.equal(secondsToFrames(1.04, 30), 31);
    assert.equal(secondsToFrames(1.02, 30), 31);
  });
});
