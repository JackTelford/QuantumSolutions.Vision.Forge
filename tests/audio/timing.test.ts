import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gapSampleCount, sentenceTimings, timelineEvents } from '../../src/audio/timing.ts';
import { Timeline } from '../../src/shared/motion/timeline.ts';

describe('gapSampleCount', () => {
  it('rounds the gap to whole samples: 0.35 s at 24 kHz is 8400', () => {
    assert.equal(gapSampleCount(0.35, 24_000), 8_400);
    assert.equal(gapSampleCount(0, 24_000), 0);
  });

  it('refuses a negative or non-finite gap', () => {
    assert.throws(() => gapSampleCount(-0.1, 24_000), RangeError);
    assert.throws(() => gapSampleCount(Number.NaN, 24_000), RangeError);
  });
});

describe('sentenceTimings', () => {
  it('lays a one-second and a half-second sentence end to end with a half-second gap at 30 fps', () => {
    const timing = sentenceTimings([24_000, 12_000], 24_000, 0.5, 30);
    assert.deepEqual(timing.sentences, [
      { startSeconds: 0, endSeconds: 1, startFrame: 0, endFrame: 30 },
      { startSeconds: 1.5, endSeconds: 2, startFrame: 45, endFrame: 60 },
    ]);
    assert.equal(timing.totalSeconds, 2);
    assert.equal(timing.totalFrames, 60);
  });

  it('rounds a start down and an end up so the frames cover the audio', () => {
    const timing = sentenceTimings([1_000, 1_000], 24_000, 0.1, 30);
    const [first, second] = timing.sentences;
    assert.deepEqual(first, { startSeconds: 0, endSeconds: 1_000 / 24_000, startFrame: 0, endFrame: 2 });
    assert.equal(second?.startFrame, Math.floor((3_400 / 24_000) * 30));
    assert.equal(second?.endFrame, Math.ceil((4_400 / 24_000) * 30));
    assert.equal(timing.totalFrames, Math.ceil((4_400 / 24_000) * 30));
  });

  it('counts frames from the sample offsets, so a whole number of frames at 25 fps never rounds up to one more', () => {
    // 6720 samples at 24 kHz is 0.28 s, exactly 7 frames at 25 fps; 0.28 * 25 in floating point is just over 7.
    const exact = sentenceTimings([6_720], 24_000, 0, 25);
    assert.deepEqual(exact.sentences, [{ startSeconds: 0, endSeconds: 0.28, startFrame: 0, endFrame: 7 }]);
    assert.equal(exact.totalFrames, 7);
    // 27840 samples is 1.16 s = 29 frames: the second sentence starts on the frame the first ends on, never before it.
    const [first, second] = sentenceTimings([27_840, 2_400], 24_000, 0, 25).sentences;
    assert.deepEqual([first?.startFrame, first?.endFrame], [0, 29]);
    assert.deepEqual([second?.startFrame, second?.endFrame], [29, 32]);
    assert.ok((second?.startFrame ?? 0) >= (first?.endFrame ?? 0));
  });

  it('places no gap before the first sentence, none after the last, and none at all when the gap is zero', () => {
    const timing = sentenceTimings([2_400, 2_400, 2_400], 24_000, 0, 24);
    assert.deepEqual(timing.sentences.map((sentence) => [sentence.startSeconds, sentence.endSeconds]), [[0, 0.1], [0.1, 0.2], [0.2, 0.3]]);
    assert.ok(Math.abs(timing.totalSeconds - 0.3) < 1e-12);
    assert.equal(timing.totalFrames, 8);
    assert.deepEqual(sentenceTimings([], 24_000, 0.35, 30), { sentences: [], totalSeconds: 0, totalFrames: 0 });
  });

  it('refuses a bad rate, a bad fps and a fractional or negative sample count', () => {
    assert.throws(() => sentenceTimings([1], 0, 0, 30), RangeError);
    assert.throws(() => sentenceTimings([1], 24_000, 0, 0), RangeError);
    assert.throws(() => sentenceTimings([1.5], 24_000, 0, 30), /Sentence 1/);
    assert.throws(() => sentenceTimings([10, -1], 24_000, 0, 30), /Sentence 2/);
  });
});

describe('timelineEvents', () => {
  it('names every sentence start and end from one, in order, and a Timeline accepts them', () => {
    const timing = sentenceTimings([24_000, 12_000], 24_000, 0.5, 30);
    const events = timelineEvents(timing);
    assert.deepEqual(events, { 'sentence-1-start': 0, 'sentence-1-end': 30, 'sentence-2-start': 45, 'sentence-2-end': 60 });
    const timeline = new Timeline({ fps: 30, events });
    assert.equal(timeline.at('sentence-2-start'), 45);
    assert.equal(timeline.between('sentence-1-end', 'sentence-2-start'), 15);
    assert.deepEqual(timeline.eventNames(), ['sentence-1-start', 'sentence-1-end', 'sentence-2-start', 'sentence-2-end']);
  });

  it('is empty for an empty narration', () => {
    assert.deepEqual(timelineEvents({ sentences: [], totalSeconds: 0, totalFrames: 0 }), {});
  });
});
