import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSemanticChecks } from '../../../src/schema/checks/index.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import { briefExample, mutated, schemaProblems } from './examples.ts';

const noDataDir = { dataDir: undefined };

describe('brief documents', () => {
  it('the example validates against the schema and passes every semantic check', () => {
    validateDocument('brief', briefExample);
    assert.deepEqual(runSemanticChecks('brief', briefExample, noDataDir), []);
  });

  it('accepts a narrated, music-backed brief with every nullable field set', () => {
    validateDocument('brief', mutated(briefExample, (copy) => {
      copy.era = '1970s';
      copy.narration = { enabled: true, voice: 'bf_emma', script: 'Meet the new bottle.' };
      copy.music = { policy: 'user-supplied', path: 'C:/music/bed.wav' };
      copy.subject.assetIds = ['hdri:studio_small_09'];
    }));
  });

  it('rejects an id that is not a slug and names /id', () => {
    const problems = schemaProblems('brief', mutated(briefExample, (copy) => { copy.id = 'Obsidian Bottle'; }));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^\/id: must match pattern/);
  });

  it('rejects a use case outside the vocabulary and lists the allowed values', () => {
    const problems = schemaProblems('brief', mutated(briefExample, (copy) => { (copy as { useCase: string }).useCase = 'advert'; }));
    assert.deepEqual(problems, ['/useCase: must be equal to one of the allowed values (allowed: product-shot, explainer, title-sequence, lower-third, kinetic-type, chart, still, custom)']);
  });

  it('rejects a frame rate outside the vocabulary, a zero duration and a one-pixel frame', () => {
    const problems = schemaProblems('brief', mutated(briefExample, (copy) => {
      (copy as { fps: number }).fps = 29.97;
      copy.durationSeconds = 0;
      copy.width = 1;
    }));
    assert.deepEqual(problems, [
      '/durationSeconds: must be > 0',
      '/fps: must be integer',
      '/fps: must be equal to one of the allowed values (allowed: 24, 25, 30, 60)',
      '/width: must be >= 2',
    ]);
  });

  it('rejects a missing nullable field and an unknown property inside subject', () => {
    const problems = schemaProblems('brief', mutated(briefExample, (copy) => {
      delete (copy as { genre?: unknown }).genre;
      (copy.subject as { colour?: string }).colour = 'black';
    }));
    assert.deepEqual(problems, ["$: must have required property 'genre'", '/subject: must NOT have additional properties (found "colour")']);
  });

  it('rejects a timestamp that is not a date-time', () => {
    assert.deepEqual(schemaProblems('brief', mutated(briefExample, (copy) => { copy.createdAt = 'today'; })), ['/createdAt: must match format "date-time"']);
  });
});
