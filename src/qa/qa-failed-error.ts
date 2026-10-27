/**
 * The error the qa command throws when a check failed and --no-fail was not
 * given: exit 1, the failed check ids in the message, the report in the hint
 * and in the result's evidence list.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';
import type { CheckId } from '../shared/contracts/qa-report.ts';

/** QA found a problem with the delivery. */
export class QaFailedError extends VisionForgeError {
  readonly failed: readonly CheckId[];
  readonly reportPath: string;

  constructor(failed: readonly CheckId[], reportPath: string) {
    super({
      code: 'qa-failed',
      message: `QA failed ${failed.length} check(s): ${failed.join(', ')}.`,
      hint: `Read the report at ${reportPath} for the measurements and the frames to look at; pass --no-fail to write the report and exit 0 anyway.`,
      evidence: [reportPath],
    });
    this.failed = [...failed];
    this.reportPath = reportPath;
  }
}
