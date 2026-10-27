import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { semanticCheckCount } from '../../../src/schema/checks/index.ts';
import { checkJob, jobRules, reviewRoundCap } from '../../../src/schema/checks/job.ts';
import type { Job } from '../../../src/shared/contracts/job.ts';
import { jobExample, mutated } from '../documents/examples.ts';

const noDataDir = { dataDir: undefined };

describe('checkJob', () => {
  it('registers every rule under the job kind', () => {
    assert.equal(semanticCheckCount('job'), jobRules.length);
    assert.equal(jobRules.length, 3);
  });

  it('passes the example', () => {
    assert.deepEqual(checkJob(jobExample, noDataDir), []);
  });

  it('reports a shot id used twice, once, even when it repeats three times', () => {
    const problems = checkJob(mutated(jobExample, (copy) => {
      for (const shot of copy.shots) shot.id = 's01';
    }), noDataDir);
    assert.deepEqual(problems, ['shot id "s01" is used more than once']);
  });

  it('reports a delivered job without a deliverable path, and accepts one that names it', () => {
    const delivered = mutated(jobExample, (copy) => { copy.status = 'delivered'; });
    assert.deepEqual(checkJob(delivered, noDataDir), ['status is delivered but deliverablePath is null']);
    assert.deepEqual(checkJob(mutated(delivered, (copy) => { copy.deliverablePath = 'C:/vf/out/k7f2q9x1/film.mp4'; }), noDataDir), []);
  });

  it('reports a shot over the review round cap of 3, and accepts one at the cap', () => {
    assert.equal(reviewRoundCap, 3);
    const roundsOf = (rounds: number): Job => mutated(jobExample, (copy) => { const shot = copy.shots[0]; if (shot !== undefined) shot.rounds = rounds; });
    assert.deepEqual(checkJob(roundsOf(4), noDataDir), ['shot "s01" has 4 review rounds, over the cap of 3']);
    assert.deepEqual(checkJob(roundsOf(3), noDataDir), []);
  });

  it('accepts a job with no shots yet', () => {
    assert.deepEqual(checkJob(mutated(jobExample, (copy) => { copy.shots = []; }), noDataDir), []);
  });
});
