import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { combineEstimates, estimateBatchFrames, estimateFromBatch } from '../../../src/lanes/blender/estimator.ts';

describe('estimateFromBatch', () => {
  it('measures three frames by default and projects the rate over the remaining frames', () => {
    assert.equal(estimateBatchFrames, 3);
    assert.deepEqual(estimateFromBatch(6000, 3, 87), { secondsPerFrame: 2, totalSeconds: 174 });
  });

  it('rounds the rate to a tenth and the total to whole seconds', () => {
    assert.deepEqual(estimateFromBatch(10_000, 3, 10), { secondsPerFrame: 3.3, totalSeconds: 33 });
    assert.deepEqual(estimateFromBatch(0, 3, 10), { secondsPerFrame: 0, totalSeconds: 0 });
  });

  it('projects nothing when nothing remains and refuses an empty batch', () => {
    assert.deepEqual(estimateFromBatch(3000, 3, 0), { secondsPerFrame: 1, totalSeconds: 0 });
    assert.throws(() => estimateFromBatch(3000, 0, 10), RangeError);
  });
});

describe('combineEstimates', () => {
  it('is null without an estimate and the estimate itself for one shot', () => {
    assert.equal(combineEstimates([]), null);
    assert.deepEqual(combineEstimates([{ estimate: { secondsPerFrame: 2, totalSeconds: 100 }, frames: 50 }]), { secondsPerFrame: 2, totalSeconds: 100 });
  });

  it('weights the rate by frames and sums the totals over several shots', () => {
    const combined = combineEstimates([
      { estimate: { secondsPerFrame: 1, totalSeconds: 30 }, frames: 30 },
      { estimate: { secondsPerFrame: 4, totalSeconds: 40 }, frames: 10 },
    ]);
    assert.deepEqual(combined, { secondsPerFrame: 1.8, totalSeconds: 70 });
  });
});
