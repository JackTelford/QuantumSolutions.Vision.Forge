/**
 * What every QA check shares: the Check record it returns, the inputs an
 * ffmpeg-backed check needs, the one way an analysis run is spawned, and the
 * rule that a check never throws for a bad video (it reports that it could
 * not measure instead). Cancellation and programming errors still propagate.
 */
import { DataFileError, ProcessFailedError, ProcessTimeoutError } from '../errors/vision-forge-error.ts';
import type { ProcessResult, ProcessRunner } from '../process/process-runner.ts';
import type { Check, CheckId } from '../shared/contracts/qa-report.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';
import type { VideoProbe } from './probe.ts';

/** A span of frames, end exclusive. */
export interface FrameRange {
  readonly start: number;
  readonly end: number;
}

/** What an ffmpeg-backed check needs. */
export interface Analysis {
  readonly runner: ProcessRunner;
  /** Absolute path of ffmpeg.exe. */
  readonly ffmpegPath: string;
  /** Absolute path of the video under test. */
  readonly videoPath: string;
  readonly probe: VideoProbe;
  /** Scratch directory for filter side files (stats, extracted frames); the caller removes it. */
  readonly workDir: string;
  readonly signal: AbortSignal;
}

/** The fields of a Check other than its id. */
export interface CheckFields {
  readonly ok: boolean;
  readonly measured: number | null;
  readonly threshold: number | null;
  readonly unit: string;
  readonly detail: string;
  readonly frames: readonly number[];
}

/** Builds a Check record with fresh arrays, so the report never shares state with a check's working data. */
export function makeCheck(id: CheckId, fields: CheckFields): Check {
  return { id, ok: fields.ok, measured: fields.measured, threshold: fields.threshold, unit: fields.unit, detail: fields.detail, frames: [...fields.frames] };
}

/** True for the errors a bad video produces: ffmpeg exited non-zero, ran out of time, or printed nothing usable. */
export function isMeasurementError(error: unknown): error is ProcessFailedError | ProcessTimeoutError | DataFileError {
  return error instanceof ProcessFailedError || error instanceof ProcessTimeoutError || error instanceof DataFileError;
}

/** A failed Check for a measurement that could not be taken; rethrows anything that is not a measurement error. */
export function unmeasured(id: CheckId, unit: string, threshold: number | null, error: unknown): Check {
  if (!isMeasurementError(error)) throw error;
  return makeCheck(id, { ok: false, measured: null, threshold, unit, detail: `could not measure: ${error.message}`, frames: [] });
}

/**
 * Runs an ffmpeg analysis: the given input and filter arguments, no progress
 * lines, output discarded. The filters' findings are on standard error or in
 * the side files the filter arguments name.
 */
export function runAnalysis(runner: ProcessRunner, ffmpegPath: string, args: readonly string[], label: string, signal: AbortSignal): Promise<ProcessResult> {
  return runFfmpeg(runner, ffmpegPath, ['-nostats', ...args, '-f', 'null', '-'], { label, failureHint: 'Check that the file decodes with ffmpeg; run the command again with --verbose to see the full output.' }, signal);
}

/** The frame that starts at `seconds`, rounded to the nearest frame and never negative. */
export function secondsToFrame(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps));
}

/** A frame number as seconds with two decimals, for details, for example "1.50 s". */
export function frameToSecondsText(frame: number, fps: number): string {
  return `${(frame / fps).toFixed(2)} s`;
}

/** "frame 30" for a single frame, "frames 30-44" for a span (end exclusive). */
export function describeFrames(range: FrameRange): string {
  return range.end - range.start <= 1 ? `frame ${range.start}` : `frames ${range.start}-${range.end - 1}`;
}

/** Rounds to a number of decimals, for measured values in the report. */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** True when `inner` lies entirely inside `outer`. */
export function rangeWithin(inner: FrameRange, outer: FrameRange): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/** The frames of `range` that are not covered by any of the `excluded` ranges, as sorted frame numbers. */
export function framesOutside(range: FrameRange, excluded: readonly FrameRange[]): number[] {
  const frames: number[] = [];
  for (let frame = range.start; frame < range.end; frame += 1) {
    if (!excluded.some((e) => frame >= e.start && frame < e.end)) frames.push(frame);
  }
  return frames;
}

/** Sorted frame numbers as contiguous runs (end exclusive): [30, 31, 32, 40] becomes [30, 33) and [40, 41). */
export function runsOf(frames: readonly number[]): FrameRange[] {
  const runs: FrameRange[] = [];
  for (const frame of frames) {
    const last = runs[runs.length - 1];
    if (last !== undefined && frame === last.end) runs[runs.length - 1] = { start: last.start, end: frame + 1 };
    else runs.push({ start: frame, end: frame + 1 });
  }
  return runs;
}

/** Sorted frame numbers as text, one span per run: "frame 30", "frames 30-34" or "frames 30-34, 40-44". */
export function describeFrameRuns(frames: readonly number[]): string {
  const runs = runsOf(frames);
  const single = runs[0];
  if (runs.length === 1 && single !== undefined) return describeFrames(single);
  return `frames ${runs.map((run) => (run.end - run.start <= 1 ? `${run.start}` : `${run.start}-${run.end - 1}`)).join(', ')}`;
}
