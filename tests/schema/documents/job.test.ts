import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSemanticChecks } from '../../../src/schema/checks/index.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import { jobExample, mutated, schemaProblems } from './examples.ts';

const noDataDir = { dataDir: undefined };

describe('job documents', () => {
  it('the example validates against the schema and passes every semantic check', () => {
    validateDocument('job', jobExample);
    assert.deepEqual(runSemanticChecks('job', jobExample, noDataDir), []);
  });

  it('accepts a delivered job with every path set', () => {
    validateDocument('job', mutated(jobExample, (copy) => {
      copy.status = 'delivered';
      copy.deliverablePath = 'C:/vf/out/k7f2q9x1/film.mp4';
      for (const shot of copy.shots) {
        shot.status = 'rendered';
        shot.manifestPath = `C:/vf/cache/${shot.key}/manifest.json`;
        shot.stillPath = `C:/vf/out/k7f2q9x1/stills/${shot.id}-r1.png`;
        shot.rounds = 1;
      }
    }));
  });

  it('rejects a job id that is not eight lowercase letters and digits', () => {
    const problems = schemaProblems('job', mutated(jobExample, (copy) => { copy.id = 'K7F2Q9X1'; }));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^\/id: must match pattern/);
  });

  it('rejects a shot key that is not a SHA-256 and names /shots/1/key', () => {
    const problems = schemaProblems('job', mutated(jobExample, (copy) => { (copy.shots[1] as { key: string }).key = 'abc'; }));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^\/shots\/1\/key: must match pattern/);
  });

  it('rejects statuses outside the vocabularies and negative rounds', () => {
    const problems = schemaProblems('job', mutated(jobExample, (copy) => {
      (copy as { status: string }).status = 'done';
      (copy.shots[0] as { status: string }).status = 'approved';
      (copy.shots[2] as { rounds: number }).rounds = -1;
    }));
    assert.deepEqual(problems, [
      '/status: must be equal to one of the allowed values (allowed: planned, stills, rendering, assembling, qa, delivered, failed)',
      '/shots/0/status: must be equal to one of the allowed values (allowed: pending, still-rendered, still-approved, rendered, failed)',
      '/shots/2/rounds: must be >= 0',
    ]);
  });

  it('rejects a missing deliverablePath, which must be null rather than absent', () => {
    assert.deepEqual(schemaProblems('job', mutated(jobExample, (copy) => { delete (copy as { deliverablePath?: unknown }).deliverablePath; })), ["$: must have required property 'deliverablePath'"]);
  });
});
