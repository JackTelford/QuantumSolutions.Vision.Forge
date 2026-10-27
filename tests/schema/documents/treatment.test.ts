import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSemanticChecks } from '../../../src/schema/checks/index.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import { mutated, schemaProblems, treatmentExample } from './examples.ts';

const noDataDir = { dataDir: undefined };

describe('treatment documents', () => {
  it('the example validates against the schema and passes every semantic check', () => {
    validateDocument('treatment', treatmentExample);
    assert.deepEqual(runSemanticChecks('treatment', treatmentExample, noDataDir), []);
  });

  it('accepts a treatment with no substitutions and no risks', () => {
    validateDocument('treatment', mutated(treatmentExample, (copy) => {
      copy.substitutions = [];
      copy.risks = [];
      copy.narrationFirst = true;
    }));
  });

  it('rejects a beat in an unknown lane and names /beats/1/lane', () => {
    const problems = schemaProblems('treatment', mutated(treatmentExample, (copy) => { (copy.beats[1] as { lane: string }).lane = 'unity'; }));
    assert.deepEqual(problems, ['/beats/1/lane: must be equal to one of the allowed values (allowed: html, three, blender)']);
  });

  it('rejects a beat of zero seconds and a substitution without a reason', () => {
    const problems = schemaProblems('treatment', mutated(treatmentExample, (copy) => {
      (copy.beats[0] as { durationSeconds: number }).durationSeconds = 0;
      delete (copy.substitutions[0] as { reason?: string }).reason;
    }));
    assert.deepEqual(problems, ['/beats/0/durationSeconds: must be > 0', "/substitutions/0: must have required property 'reason'"]);
  });

  it('rejects a briefId that is not a slug', () => {
    const problems = schemaProblems('treatment', mutated(treatmentExample, (copy) => { copy.briefId = 'A'; }));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^\/briefId: must match pattern/);
  });
});
