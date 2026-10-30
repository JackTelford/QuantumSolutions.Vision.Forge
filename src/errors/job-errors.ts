/**
 * Errors of the two job-driven finishing commands, `assemble --job` and
 * `qa --job`: each names the stage that has to run first, so the reader of
 * the result knows which command to go back to.
 */
import { VisionForgeError } from './vision-forge-error.ts';

/** A shot the assembly plan needs has no complete render in the cache. */
export class ShotNotRenderedError extends VisionForgeError {
  readonly shotId: string;

  constructor(shotId: string, reason: string, jobDir: string) {
    super({
      code: 'shot-not-rendered',
      message: `Shot "${shotId}" is not rendered: ${reason}.`,
      hint: `Run render first: render --job ${jobDir}; assemble needs every shot's frames in the cache with a complete manifest.`,
    });
    this.shotId = shotId;
  }
}

/** The job has no delivery (or no assembly plan) for qa to measure. */
export class JobNotAssembledError extends VisionForgeError {
  readonly jobId: string;

  constructor(jobId: string, reason: string, jobDir: string) {
    super({
      code: 'job-not-assembled',
      message: `Job "${jobId}" has no delivery to check: ${reason}.`,
      hint: `Run assemble first: assemble --job ${jobDir}; it writes the delivery and the assembly plan the checks read.`,
    });
    this.jobId = jobId;
  }
}
