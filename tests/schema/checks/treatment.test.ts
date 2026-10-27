import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { semanticCheckCount } from '../../../src/schema/checks/index.ts';
import { checkTreatment, treatmentRules } from '../../../src/schema/checks/treatment.ts';
import { mutated, treatmentExample } from '../documents/examples.ts';

const noDataDir = { dataDir: undefined };

describe('checkTreatment', () => {
  it('registers every rule under the treatment kind', () => {
    assert.equal(semanticCheckCount('treatment'), treatmentRules.length);
    assert.equal(treatmentRules.length, 3);
  });

  it('passes the example', () => {
    assert.deepEqual(checkTreatment(treatmentExample, noDataDir), []);
  });

  it('reports a beat id used twice, once', () => {
    const problems = checkTreatment(mutated(treatmentExample, (copy) => {
      const first = copy.beats[0];
      if (first !== undefined) copy.beats.push({ ...first, id: 'b1', shotIds: ['s04'] });
    }), noDataDir);
    assert.deepEqual(problems, ['beat id "b1" is used more than once']);
  });

  it('reports a shot id that belongs to two beats', () => {
    const problems = checkTreatment(mutated(treatmentExample, (copy) => { (copy.beats[1] as { shotIds: string[] }).shotIds = ['s02', 's03']; }), noDataDir);
    assert.deepEqual(problems, ['shot id "s02" appears in more than one beat']);
  });

  it('reports a shot id repeated inside one beat as well', () => {
    const problems = checkTreatment(mutated(treatmentExample, (copy) => { (copy.beats[0] as { shotIds: string[] }).shotIds = ['s01', 's01']; }), noDataDir);
    assert.deepEqual(problems, ['shot id "s01" appears in more than one beat']);
  });

  it('reports a beat with no shots', () => {
    const problems = checkTreatment(mutated(treatmentExample, (copy) => { (copy.beats[0] as { shotIds: string[] }).shotIds = []; }), noDataDir);
    assert.deepEqual(problems, ['beat "b1" has no shots']);
  });

  it('accepts a treatment with no beats', () => {
    assert.deepEqual(checkTreatment(mutated(treatmentExample, (copy) => { copy.beats = []; }), noDataDir), []);
  });
});
