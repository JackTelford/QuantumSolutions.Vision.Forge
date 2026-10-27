import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { SchemaValidationError } from '../../src/errors/vision-forge-error.ts';
import { readJsonFile } from '../../src/fs/atomic-json.ts';
import { makeCheck } from '../../src/qa/check.ts';
import { QaFailedError } from '../../src/qa/qa-failed-error.ts';
import { buildQaReport, failedCheckIds, writeQaReport } from '../../src/qa/report.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { QaReport, RubricRound } from '../../src/shared/contracts/qa-report.ts';

const subject = { kind: 'deliverable' as const, path: 'C:\\vf\\out\\film.mp4', shotId: null };
const okCheck = makeCheck('black-frames', { ok: true, measured: 0, threshold: 0, unit: 'frames', detail: 'no black frames', frames: [] });
const badCheck = makeCheck('pops', { ok: false, measured: 0.31, threshold: 0.6, unit: 'ssim', detail: 'frame 30 differs from frame 29 (SSIM 0.31) with no planned cut there', frames: [30] });
const scores = { focalPoint: 2, composition: 2, lightDirection: 1, materials: 2, depthCues: 1, typography: 2, palette: 2, nothingDefault: 2, continuity: 2, artifacts: 2 };
const passedRound: RubricRound = { shotId: 's01', round: 1, scores, faults: ['a', 'b', 'c'], pass: true };
const when = new Date('2026-10-26T20:00:00.000Z');

describe('qa report', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-qa-report-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('passes only when every check is ok and every rubric round passed', () => {
    assert.equal(buildQaReport(subject, [okCheck], [passedRound], when).passed, true);
    assert.equal(buildQaReport(subject, [okCheck, badCheck], [], when).passed, false);
    assert.equal(buildQaReport(subject, [okCheck], [{ ...passedRound, pass: false }], when).passed, false);
    assert.equal(buildQaReport(subject, [], [], when).passed, true);
  });

  it('stamps the time in RFC 3339 UTC with milliseconds and copies the arrays', () => {
    const report = buildQaReport(subject, [badCheck], [passedRound], when);
    assert.equal(report.generatedAt, '2026-10-26T20:00:00.000Z');
    assert.notEqual(report.checks[0]?.frames, badCheck.frames);
    assert.deepEqual(report.checks[0]?.frames, [30]);
    assert.notEqual(report.rubric[0]?.faults, passedRound.faults);
  });

  it('lists each failed check id once, in order', () => {
    assert.deepEqual(failedCheckIds([okCheck, badCheck, { ...badCheck, frames: [40] }, { ...okCheck, id: 'fps', ok: false }]), ['pops', 'fps']);
  });

  it('writes a document that validates against the schema and reads back equal', () => {
    const report = buildQaReport(subject, [okCheck, badCheck], [passedRound], when);
    const path = join(dir, 'nested', 'film.qa.json');
    writeQaReport(path, report);
    const read = readJsonFile(path);
    validateDocument('qa-report', read);
    assert.deepEqual(read, report);
  });

  it('refuses to write a report that breaks the schema', () => {
    const broken = { ...buildQaReport(subject, [okCheck], [], when), checks: [{ ...okCheck, unit: 7 }] } as unknown as QaReport;
    assert.throws(() => writeQaReport(join(dir, 'broken.json'), broken), SchemaValidationError);
  });

  it('the qa-failed error lists the ids and points at the report', () => {
    const error = new QaFailedError(['black-frames', 'pops'], 'C:\\vf\\out\\qa\\film.qa.json');
    assert.equal(error.code, 'qa-failed');
    assert.equal(error.exitCode, 1);
    assert.match(error.message, /2 check\(s\): black-frames, pops/);
    assert.match(error.hint, /C:\\vf\\out\\qa\\film\.qa\.json/);
    assert.match(error.hint, /--no-fail/);
  });
});
