/**
 * The error the still command raises when the gate fails. It is thrown
 * after the still, the report and the job have been written, so the result
 * lists both files as evidence and the reviewer can open them.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';

/** A still did not pass the gate; the message names each failing check. */
export class StillGateError extends VisionForgeError {
  readonly shotId: string;
  readonly reportPath: string;

  constructor(shotId: string, failures: string, reportPath: string, stillPath: string) {
    super({
      code: 'still-gate',
      message: `The still of shot "${shotId}" failed the gate: ${failures}`,
      hint: 'Fix the shot spec or the look (never the still) and run still again; the gate report names each check.',
      evidence: [reportPath, stillPath],
    });
    this.shotId = shotId;
    this.reportPath = reportPath;
  }
}
