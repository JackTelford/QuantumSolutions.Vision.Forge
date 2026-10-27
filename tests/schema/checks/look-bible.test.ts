import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { semanticCheckCount } from '../../../src/schema/checks/index.ts';
import { checkLookBible, lookBibleRules, minimumTextContrast, typeScaleRatios } from '../../../src/schema/checks/look-bible.ts';
import { lookBibleExample, mutated } from '../documents/examples.ts';

const noDataDir = { dataDir: undefined };

describe('checkLookBible', () => {
  it('registers every rule under the look-bible kind', () => {
    assert.equal(semanticCheckCount('look-bible'), lookBibleRules.length);
    assert.equal(lookBibleRules.length, 4);
    assert.equal(minimumTextContrast, 4.5);
    assert.deepEqual(typeScaleRatios, [1.25, 1.333]);
  });

  it('passes the example', () => {
    assert.deepEqual(checkLookBible(lookBibleExample, noDataDir), []);
  });

  it('reports mid-gray text on white over both background and surface', () => {
    const problems = checkLookBible(mutated(lookBibleExample, (copy) => {
      copy.palette.text = '#808080';
      copy.palette.background = '#ffffff';
      copy.palette.surface = '#ffffff';
    }), noDataDir);
    assert.deepEqual(problems, [
      'palette.text #808080 over palette.background #ffffff has contrast 3.95, below the WCAG minimum of 4.5',
      'palette.text #808080 over palette.surface #ffffff has contrast 3.95, below the WCAG minimum of 4.5',
    ]);
  });

  it('reports a surface the text cannot be read on while the background is fine', () => {
    const problems = checkLookBible(mutated(lookBibleExample, (copy) => { copy.palette.surface = '#bfbfbf'; }), noDataDir);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^palette\.text #f4f1ea over palette\.surface #bfbfbf has contrast 1\.\d\d, below/);
  });

  it('accepts text at exactly the WCAG minimum: #767676 on white is 4.54', () => {
    assert.deepEqual(checkLookBible(mutated(lookBibleExample, (copy) => {
      copy.palette.text = '#767676';
      copy.palette.background = '#ffffff';
      copy.palette.surface = '#ffffff';
    }), noDataDir), []);
  });

  it('reports a QA band whose minimum is not below its maximum', () => {
    assert.deepEqual(checkLookBible(mutated(lookBibleExample, (copy) => { copy.qa.yavgMin = 140; }), noDataDir), ['qa.yavgMin 140 must be below qa.yavgMax 140']);
    assert.deepEqual(checkLookBible(mutated(lookBibleExample, (copy) => { copy.qa.yavgMin = 200; }), noDataDir), ['qa.yavgMin 200 must be below qa.yavgMax 140']);
  });

  it('reports a scale ratio the schema range allows but the type system does not', () => {
    assert.deepEqual(checkLookBible(mutated(lookBibleExample, (copy) => { copy.typography.scaleRatio = 1.3; }), noDataDir), ['typography.scaleRatio must be 1.25 or 1.333; got 1.3']);
    assert.deepEqual(checkLookBible(mutated(lookBibleExample, (copy) => { copy.typography.scaleRatio = 1.333; }), noDataDir), []);
  });
});
