import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { framesPerBatch, planBatches } from '../../../src/lanes/blender/batches.ts';

const range = (first: number, count: number): number[] => Array.from({ length: count }, (_, index) => first + index);

describe('planBatches', () => {
  it('cuts a whole shot into the three-frame estimate batch and then batches of thirty', () => {
    assert.equal(framesPerBatch, 30);
    const batches = planBatches(range(0, 90));
    assert.deepEqual(batches.map((batch) => [batch[0], batch.length]), [[0, 3], [3, 30], [33, 30], [63, 27]]);
    assert.deepEqual(batches.flat(), range(0, 90), 'every frame once, in order');
  });

  it('renders three or fewer frames as one batch', () => {
    assert.deepEqual(planBatches([26]), [[26]]);
    assert.deepEqual(planBatches([0, 1, 2]), [[0, 1, 2]]);
    assert.deepEqual(planBatches([0, 1, 2, 3]), [[0, 1, 2], [3]]);
    assert.deepEqual(planBatches([]), []);
  });

  it('never puts frames of two runs in one batch, so Blender always renders a contiguous range', () => {
    const resumed = [...range(0, 5), ...range(40, 4), 99];
    const batches = planBatches(resumed);
    assert.deepEqual(batches, [[0, 1, 2], [3, 4], [40, 41, 42, 43], [99]]);
    for (const batch of batches) assert.deepEqual(batch, range(batch[0] ?? 0, batch.length));
  });

  it('sorts and de-duplicates what it is given', () => {
    assert.deepEqual(planBatches([3, 1, 2, 2, 0]), [[0, 1, 2], [3]]);
  });

  it('takes other batch sizes and refuses an empty one', () => {
    assert.deepEqual(planBatches(range(0, 10), 4, 2), [[0, 1], [2, 3, 4, 5], [6, 7, 8, 9]]);
    assert.throws(() => planBatches([0], 0), RangeError);
  });
});
