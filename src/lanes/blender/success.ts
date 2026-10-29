/**
 * The success predicate of ADR 0004 decision 7: a Blender run rendered a
 * batch when its exit code is 0 (or the documented teardown crash
 * 0xC0000005 with every frame present and written after the spawn), every
 * expected PNG exists, the first frame is not black (its signalstats YAVG
 * is more than 2 above limited-range black) and no crash log appeared
 * since the spawn. Exit 3 is the
 * applier's Python raising; exit 1 is Blender refusing to render; a
 * timeout is its own failure. The exit code is read last among the
 * failures, because some pre-render failures exit 0 with no file, and the
 * files, not the code, are the proof.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BlenderErrorCode } from '../../errors/blender-errors.ts';
import { BlenderRenderError, BlenderScriptError, BlenderTimeoutError } from '../../errors/blender-errors.ts';
import type { BlenderError } from '../../errors/blender-errors.ts';
import { ProcessFailedError } from '../../errors/vision-forge-error.ts';
import type { ProcessResult, ProcessRunner } from '../../process/process-runner.ts';
import { stderrTail } from '../../process/process-runner.ts';
import { runAnalysis } from '../../qa/check.ts';
import { exposureFilter } from '../../qa/exposure.ts';
import { parseSignalstatsYavg } from '../../qa/parse.ts';
import { rgbToLumaConversion } from '../../qa/text-contrast.ts';
import { pythonExitCode } from '../../tools/blender-probe.ts';

/** The exit code of the teardown crash Blender 5.2.3 can end a successful render with (0xC0000005, ADR 0004). */
export const teardownCrashExitCode = 3221225477;

/** The luma of black in the limited range signalstats reads (the gate's BT.709 conversion puts RGB 0 at Y 16). */
export const limitedRangeBlack = 16;

/** A first frame whose average luma is at or below this (within 2 of black) is black: nothing was lit, or nothing was rendered into the file. */
export const blackFrameYavg = limitedRangeBlack + 2;

/** How much older than the spawn a frame's write time may read and still count as written by this run: slack for coarse file-system clocks. */
export const freshnessSlackMs = 2000;

/** What the predicate decided. */
export type BlenderVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: BlenderErrorCode; readonly reason: string; readonly stderrTail: string };

/** The crash log Blender writes in background mode: %TEMP%\blender.crash.txt on Windows, /tmp/blender.crash.txt elsewhere. */
export function crashLogPath(platform: NodeJS.Platform = process.platform, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (platform === 'win32') {
    const temp = env['TEMP'] ?? env['TMP'] ?? 'C:\\Windows\\Temp';
    return join(temp, 'blender.crash.txt');
  }
  return '/tmp/blender.crash.txt';
}

/** The crash log's modification time in milliseconds, or undefined when there is none; read before the spawn so a fresh one can be told from an old one. */
export function crashLogMtime(path: string): number | undefined {
  return existsSync(path) ? statSync(path).mtimeMs : undefined;
}

/** True when the crash log exists and is newer than it was before the spawn (or did not exist then). */
export function crashLogIsNew(path: string, mtimeBefore: number | undefined): boolean {
  const now = crashLogMtime(path);
  if (now === undefined) return false;
  return mtimeBefore === undefined || now > mtimeBefore;
}

/** The frames of the list that are missing, and the ones present but written before the spawn (stale from an earlier run). */
export function checkFrames(paths: readonly string[], spawnedAt: number): { readonly missing: readonly string[]; readonly stale: readonly string[] } {
  const missing: string[] = [];
  const stale: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) missing.push(path);
    else if (statSync(path).mtimeMs < spawnedAt - freshnessSlackMs) stale.push(path);
  }
  return { missing, stale };
}

/** What judging a run needs. */
export interface JudgeInputs {
  readonly result: ProcessResult;
  /** The PNG every frame of the batch must land at, in frame order. */
  readonly expectedFrames: readonly string[];
  /** Milliseconds since the epoch, taken just before the spawn. */
  readonly spawnedAt: number;
  readonly crashLogPath: string;
  /** The crash log's modification time before the spawn; undefined when there was none. */
  readonly crashLogMtimeBefore: number | undefined;
  readonly runner: ProcessRunner;
  readonly ffmpegPath: string;
  /** Where signalstats prints the first frame's luma. */
  readonly statsPath: string;
  readonly signal: AbortSignal;
}

/** The average luma of a PNG through the gate's BT.709 conversion and signalstats; undefined when ffmpeg could not decode the file or printed no luma. */
export async function measureFrameYavg(runner: ProcessRunner, ffmpegPath: string, png: string, statsPath: string, signal: AbortSignal): Promise<number | undefined> {
  try {
    await runAnalysis(runner, ffmpegPath, ['-i', png, '-vf', `${rgbToLumaConversion},${exposureFilter(statsPath)}`, '-frames:v', '1'], 'ffmpeg signalstats', signal);
  } catch (error: unknown) {
    // ffmpeg refusing the file (a PNG Blender did not finish writing, a zero-byte file) is a bad render, which the ladder moves past; a timeout, a cancellation or a missing ffmpeg is still thrown.
    if (error instanceof ProcessFailedError) return undefined;
    throw error;
  }
  if (!existsSync(statsPath)) return undefined;
  return parseSignalstatsYavg(readFileSync(statsPath, 'utf8'))[0];
}

/** A failure verdict with the stderr tail attached. */
function failed(code: BlenderErrorCode, reason: string, result: ProcessResult): BlenderVerdict {
  return { ok: false, code, reason, stderrTail: stderrTail(result.stderr) };
}

/** Judges one Blender run by the predicate above. Never throws for a bad render (an unreadable first frame included); a measurement that cannot run (ffmpeg missing or timing out) still throws. */
export async function judgeBlenderRun(inputs: JudgeInputs): Promise<BlenderVerdict> {
  const { result } = inputs;
  if (result.timedOut) return failed('blender-timeout', `Blender was stopped after ${Math.round(result.elapsedMs / 1000)} s.`, result);
  if (result.exitCode === pythonExitCode) return failed('blender-script', 'the applier raised a Python exception.', result);
  const frames = checkFrames(inputs.expectedFrames, inputs.spawnedAt);
  if (frames.missing.length > 0) return failed('blender-render', `${frames.missing.length} of ${inputs.expectedFrames.length} frame(s) were not written (first missing: ${frames.missing[0] ?? ''}); Blender exited with code ${describeExit(result)}.`, result);
  if (frames.stale.length > 0) return failed('blender-render', `${frames.stale.length} frame(s) on disk were written before this run started (first: ${frames.stale[0] ?? ''}); Blender exited with code ${describeExit(result)}.`, result);
  if (result.exitCode !== 0 && result.exitCode !== teardownCrashExitCode) {
    return failed('blender-render', `Blender exited with code ${describeExit(result)} although every frame was written.`, result);
  }
  if (crashLogIsNew(inputs.crashLogPath, inputs.crashLogMtimeBefore)) {
    return failed('blender-render', `Blender wrote a crash log at ${inputs.crashLogPath} during this run.`, result);
  }
  const first = inputs.expectedFrames[0];
  if (first !== undefined) {
    const yavg = await measureFrameYavg(inputs.runner, inputs.ffmpegPath, first, inputs.statsPath, inputs.signal);
    if (yavg === undefined) return failed('blender-render', `signalstats printed no luma for ${first}; the file is not a readable PNG (Blender exited with code ${describeExit(result)}).`, result);
    if (yavg <= blackFrameYavg) return failed('blender-render', `the first frame ${first} is black (YAVG ${yavg.toFixed(1)}); the scene rendered nothing.`, result);
  }
  return { ok: true };
}

/** "3221225477", "0" or "none (killed)" for the sentences above. */
export function describeExit(result: ProcessResult): string {
  return result.exitCode === null ? 'none (killed)' : String(result.exitCode);
}

/** The error a failed verdict becomes, with the scene path and the time limit the run had. */
export function verdictError(verdict: Extract<BlenderVerdict, { ok: false }>, scenePath: string, timeoutMs: number): BlenderError {
  const details = { scenePath, stderrTail: verdict.stderrTail };
  switch (verdict.code) {
    case 'blender-script': return new BlenderScriptError(details);
    case 'blender-timeout': return new BlenderTimeoutError(timeoutMs, details);
    case 'blender-render': return new BlenderRenderError(verdict.reason, details);
  }
}
