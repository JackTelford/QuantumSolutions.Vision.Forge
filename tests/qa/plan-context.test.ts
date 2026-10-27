import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clipTailRanges, planContext } from '../../src/qa/plan-context.ts';
import { planFor } from './synthetic-clips.ts';

describe('plan context', () => {
  it('places clips joined by cuts back to back and lists every clip start as a cut', () => {
    const context = planContext(planFor([{ id: 'a', frames: 30 }, { id: 'b', frames: 15 }, { id: 'c', frames: 60 }]));
    assert.equal(context.totalFrames, 105);
    assert.deepEqual(context.clips, [{ id: 'a', start: 0, end: 30 }, { id: 'b', start: 30, end: 45 }, { id: 'c', start: 45, end: 105 }]);
    assert.deepEqual(context.cutFrames, [0, 30, 45]);
    assert.deepEqual(context.fadeBlackRanges, []);
    assert.equal(context.transitionAfter.size, 0);
    assert.equal(context.loudnessLufs, undefined);
    assert.equal(context.truePeakDbtp, undefined);
  });

  it('overlaps transitions, keeps only hard cuts as cut frames and records fade-black spans', () => {
    const plan = planFor(
      [{ id: 'a', frames: 30 }, { id: 'b', frames: 15 }, { id: 'c', frames: 60 }],
      [{ afterClipId: 'a', type: 'dissolve', frames: 10 }, { afterClipId: 'b', type: 'fade-black', frames: 6 }],
    );
    const context = planContext(plan);
    assert.equal(context.totalFrames, 89);
    assert.deepEqual(context.clips, [{ id: 'a', start: 0, end: 20 }, { id: 'b', start: 20, end: 29 }, { id: 'c', start: 29, end: 89 }]);
    assert.deepEqual(context.cutFrames, [0]);
    assert.deepEqual(context.fadeBlackRanges, [{ start: 29, end: 35 }]);
    assert.deepEqual([...context.transitionAfter].sort(), [0, 1]);
  });

  it('treats an explicit cut transition like no transition', () => {
    const context = planContext(planFor([{ id: 'a', frames: 30 }, { id: 'b', frames: 30 }], [{ afterClipId: 'a', type: 'cut', frames: 0 }]));
    assert.deepEqual(context.cutFrames, [0, 30]);
    assert.equal(context.transitionAfter.size, 0);
  });

  it('carries the audio targets and the geometry', () => {
    const plan = { ...planFor([{ id: 'a', frames: 30 }]), audio: { narration: [], music: null, loudnessLufs: -14, truePeakDbtp: -1.5 } };
    const context = planContext(plan);
    assert.equal(context.loudnessLufs, -14);
    assert.equal(context.truePeakDbtp, -1.5);
    assert.deepEqual([context.fps, context.width, context.height], [30, 320, 180]);
  });

  it('names the last half second of every clip as a tolerated hold', () => {
    const context = planContext(planFor([{ id: 'a', frames: 30 }, { id: 'b', frames: 10 }]));
    assert.deepEqual(clipTailRanges(context, 0.5), [{ start: 15, end: 30 }, { start: 30, end: 40 }]);
  });
});
