import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSemanticChecks } from '../../../src/schema/checks/index.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import { lookBibleExample, mutated, schemaProblems } from './examples.ts';

const noDataDir = { dataDir: undefined };

describe('look-bible documents', () => {
  it('the example validates against the schema and passes every semantic check', () => {
    validateDocument('look-bible', lookBibleExample);
    assert.deepEqual(runSemanticChecks('look-bible', lookBibleExample, noDataDir), []);
  });

  it('accepts a graphic look with the perfect-fourth scale and no grade effects', () => {
    validateDocument('look-bible', mutated(lookBibleExample, (copy) => {
      copy.preset = 'paper-flat';
      copy.toneMapping = 'standard';
      copy.typography.scaleRatio = 1.333;
      copy.palette = { background: '#ffffff', surface: '#f2f2f2', primary: '#1a1a1a', accent: '#d8322c', text: '#111111', highlight: '#ffffff' };
      copy.grade.vignetteAmount = 0;
      copy.grade.grainAmount = 0;
      copy.grade.halationAmount = 0;
    }));
  });

  it('rejects an uppercase or short hex colour and names the palette path', () => {
    const problems = schemaProblems('look-bible', mutated(lookBibleExample, (copy) => {
      copy.palette.text = '#F4F1EA';
      copy.palette.accent = '#4cc';
    }));
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? '', /^\/palette\/accent: must match pattern/);
    assert.match(problems[1] ?? '', /^\/palette\/text: must match pattern/);
  });

  it('rejects grade values outside their ranges, naming each path', () => {
    const problems = schemaProblems('look-bible', mutated(lookBibleExample, (copy) => {
      copy.grade.lift.r = 1.5;
      copy.grade.gain.b = 5;
      copy.grade.saturation = -0.1;
      copy.grade.splitTone.shadowHue = 361;
      copy.grade.grainSeed = -1;
    }));
    assert.deepEqual(problems, [
      '/grade/lift/r: must be <= 1',
      '/grade/gain/b: must be <= 4',
      '/grade/saturation: must be >= 0',
      '/grade/splitTone/shadowHue: must be <= 360',
      '/grade/grainSeed: must be >= 0',
    ]);
  });

  it('rejects a scale ratio outside 1.25 to 1.333 and a font outside the bundle', () => {
    const problems = schemaProblems('look-bible', mutated(lookBibleExample, (copy) => {
      copy.typography.scaleRatio = 1.5;
      (copy.typography as { body: string }).body = 'arial';
    }));
    assert.deepEqual(problems, [
      '/typography/body: must be equal to one of the allowed values (allowed: inter, space-grotesk, playfair-display, jetbrains-mono)',
      '/typography/scaleRatio: must be <= 1.333',
    ]);
  });

  it('rejects a QA band outside 0 to 255', () => {
    assert.deepEqual(schemaProblems('look-bible', mutated(lookBibleExample, (copy) => { copy.qa.yavgMax = 256; })), ['/qa/yavgMax: must be <= 255']);
  });
});
