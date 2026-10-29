import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  durationFrames,
  durationTable,
  entranceOverlapFrames,
  isWithinDurationClass,
  maxNonCameraDurationMs,
  nextEntranceStartFrame,
  quietTailFrames,
  violatesQuietTail,
} from '../../../src/shared/motion/durations.ts';

describe('the duration table', () => {
  it('holds the bands of the motion grammar in milliseconds', () => {
    assert.deepEqual(durationTable.small, { minMs: 150, maxMs: 250 });
    assert.deepEqual(durationTable.medium, { minMs: 300, maxMs: 400 });
    assert.deepEqual(durationTable.fullScreen, { minMs: 450, maxMs: 600 });
    assert.deepEqual(durationTable.staggerBetweenSiblings, { minMs: 40, maxMs: 80 });
    assert.equal(maxNonCameraDurationMs, durationTable.fullScreen.maxMs);
  });

  it('tells whether a duration lies in its class, inclusive at both ends', () => {
    assert.equal(isWithinDurationClass(150, 'small'), true);
    assert.equal(isWithinDurationClass(250, 'small'), true);
    assert.equal(isWithinDurationClass(251, 'small'), false);
    assert.equal(isWithinDurationClass(60, 'staggerBetweenSiblings'), true);
    assert.equal(isWithinDurationClass(700, 'fullScreen'), false);
  });
});

describe('durationFrames', () => {
  it('rounds milliseconds to the nearest frame at the frame rate', () => {
    assert.equal(durationFrames(450, 30), 14);
    assert.equal(durationFrames(450, 24), 11);
    assert.equal(durationFrames(450, 60), 27);
    assert.equal(durationFrames(300, 25), 8);
    assert.equal(durationFrames(1000, 30), 30);
  });

  it('never gives fewer than one frame', () => {
    assert.equal(durationFrames(0, 30), 1);
    assert.equal(durationFrames(10, 24), 1);
  });
});

describe('the entrance overlap rule', () => {
  it('overlaps the next entrance by 30 percent of the previous duration', () => {
    assert.equal(entranceOverlapFrames(20), 6);
    assert.equal(entranceOverlapFrames(14), 4);
    assert.equal(nextEntranceStartFrame(10, 20), 24);
    assert.equal(nextEntranceStartFrame(24, 20), 38);
  });
});

describe('the quiet tail rule', () => {
  it('keeps the last 10 frames before a cut free of animation', () => {
    assert.equal(quietTailFrames, 10);
    assert.equal(violatesQuietTail(110, 120), false);
    assert.equal(violatesQuietTail(111, 120), true);
    assert.equal(violatesQuietTail(120, 120), true);
  });

  it('lets an exit run into the tail as long as it completes at the cut', () => {
    assert.equal(violatesQuietTail(120, 120, true), false);
    assert.equal(violatesQuietTail(115, 120, true), false);
    assert.equal(violatesQuietTail(121, 120, true), true);
  });
});
