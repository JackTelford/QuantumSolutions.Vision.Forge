/**
 * Errors the assembler raises beyond the shared ones: a delivery that reads
 * back differently from the plan, a loudness analysis that printed nothing
 * usable, and a read-back that ran out of time.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';

/** The written delivery does not match the plan (frame count, rate, size or sample aspect ratio). */
export class AssembleVerificationError extends VisionForgeError {
  readonly outputPath: string;
  readonly problems: readonly string[];

  constructor(outputPath: string, problems: readonly string[]) {
    super({
      code: 'assemble-verify',
      message: `The delivery ${outputPath} does not match the plan: ${problems.join('; ')}.`,
      hint: 'Check that every clip source has at least durationFrames frames at the plan fps, then run assemble again with --verbose to see the ffmpeg commands.',
    });
    this.outputPath = outputPath;
    this.problems = problems;
  }
}

/** loudnorm's analysis pass did not print the JSON block the second pass needs. */
export class LoudnessMeasurementError extends VisionForgeError {
  readonly mixPath: string;

  constructor(mixPath: string, stderrTail: string) {
    super({
      code: 'loudness-measurement',
      message: `ffmpeg did not report loudness statistics for ${mixPath}.${stderrTail.length > 0 ? ` Last output: ${stderrTail}` : ''}`,
      hint: 'The mixed audio may be silent or unreadable. Check the narration and music files, then run assemble again with --verbose.',
    });
    this.mixPath = mixPath;
  }
}

/** ffprobe ran out of time counting the delivery's frames. The delivery itself was written. */
export class DeliveryProbeTimeoutError extends VisionForgeError {
  readonly outputPath: string;
  readonly timeoutMs: number;

  constructor(outputPath: string, timeoutMs: number, cause?: unknown) {
    super({
      code: 'assemble-probe-timeout',
      message: `ffprobe did not finish reading ${outputPath} back within ${Math.round(timeoutMs / 1000)} s and was stopped.`,
      hint: 'The delivery was written but could not be verified in time; run assemble again or probe it with ffprobe -count_frames.',
      cause,
    });
    this.outputPath = outputPath;
    this.timeoutMs = timeoutMs;
  }
}
