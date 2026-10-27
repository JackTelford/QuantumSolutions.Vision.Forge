/**
 * The QA report document: built from the subject, the checks and the vision
 * rubric rounds, validated against schemas/qa-report.schema.json and written
 * atomically.
 */
import { writeJsonAtomic } from '../fs/atomic-json.ts';
import { validateDocument } from '../schema/validator.ts';
import type { Check, CheckId, QaReport, RubricRound, Subject } from '../shared/contracts/qa-report.ts';

/** Builds the report; passed is true only when every check is ok and every rubric round passed. */
export function buildQaReport(subject: Subject, checks: readonly Check[], rubric: readonly RubricRound[], generatedAt: Date = new Date()): QaReport {
  return {
    kind: 'qa-report',
    version: 1,
    generatedAt: generatedAt.toISOString(),
    subject: { kind: subject.kind, path: subject.path, shotId: subject.shotId },
    checks: checks.map((check) => ({ ...check, frames: [...check.frames] })),
    rubric: rubric.map((round) => ({ ...round, scores: { ...round.scores }, faults: [...round.faults] })),
    passed: checks.every((check) => check.ok) && rubric.every((round) => round.pass),
  };
}

/** The ids of the checks that failed, each once, in report order. */
export function failedCheckIds(checks: readonly Check[]): CheckId[] {
  const ids: CheckId[] = [];
  for (const check of checks) {
    if (!check.ok && !ids.includes(check.id)) ids.push(check.id);
  }
  return ids;
}

/** Validates the report against its schema and writes it atomically; throws SchemaValidationError for a malformed report. */
export function writeQaReport(path: string, report: QaReport): void {
  validateDocument('qa-report', report);
  writeJsonAtomic(path, report);
}
