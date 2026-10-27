/**
 * What an installed ffmpeg offers: its version, its filters and its
 * encoders, read from `ffmpeg -version`, `-filters` and `-encoders`, and the
 * sets this repository needs. Parsing is separated from running so tests
 * can feed captured output through a fake runner.
 */
import { basename, extname } from 'node:path';
import type { ProcessResult, ProcessRunner } from '../process/process-runner.ts';

/** Filters every lane's assembly, finishing and QA chain needs (probe P6 and ADR 0008); a build without one of them closes the lanes. */
export const requiredFilters: readonly string[] = [
  'xfade', 'lut3d', 'loudnorm', 'sidechaincompress', 'blackdetect', 'freezedetect', 'ssim', 'psnr', 'signalstats', 'ebur128',
  'scdet', 'noise', 'vignette', 'subtitles', 'concat', 'scale', 'format', 'fps', 'pad', 'tpad', 'metadata',
  'split', 'crop', 'select',
];

/** Filters only the contact sheet needs (labels through libfreetype, tiling); a build without them keeps every lane open and `sheet` names the gap. */
export const sheetFilters: readonly string[] = ['drawtext', 'tile'];

/** Encoders assembly cannot do without: H.264 delivery, AAC and PCM audio. */
export const requiredEncoders: readonly string[] = ['libx264', 'aac', 'pcm_s16le'];

/** Encoders that enable optional deliverables (HEVC, ProRes, Opus); their absence is reported, not a problem. */
export const optionalEncoders: readonly string[] = ['libx265', 'prores_ks', 'libopus'];

/** How long a query such as `-filters` may take before it is given up on. */
const queryTimeoutMs = 30_000;

/**
 * The version token of the first `ffmpeg -version` (or `ffprobe -version`)
 * line: "ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright ..." gives
 * "9.0.2-full_build-www.gyan.dev". A leading "n" before the digits, the git
 * tag convention of the BtbN builds ("n8.1.3-24-g92611900bb"), is dropped so
 * every build's version starts with its number.
 */
export function parseFfmpegVersion(text: string): string | undefined {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const match = /^\s*ff(?:mpeg|probe) version n?(\d\S*)/i.exec(firstLine) ?? /^\s*ff(?:mpeg|probe) version (\S+)/i.exec(firstLine);
  return match?.[1];
}

/**
 * Filter names from `ffmpeg -filters` output. Each filter line is flags, the
 * name and an `inputs->outputs` signature, for example
 * ` TS lut3d             V->V       Adjust colors using a 3D LUT.`; the
 * header lines have no signature and are skipped. ffmpeg 9 prints two flag
 * columns (timeline, slice threading); 7.x and earlier printed a third
 * (command support, ` T.C`), so both widths are accepted.
 */
export function parseFilterNames(text: string): readonly string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[A-Z.]{2,3}\s+([A-Za-z0-9_]+)\s+[A-Z|]+->[A-Z|]+/.exec(line);
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names;
}

/**
 * Encoder names from `ffmpeg -encoders` output. Each encoder line is six
 * flag characters and the name, for example
 * ` V....D libx264              libx264 H.264 / AVC ...`; the legend lines
 * (` V..... = Video`) have `=` where a name would be and are skipped.
 */
export function parseEncoderNames(text: string): readonly string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[VAS][A-Z.]{5}\s+([A-Za-z0-9_]+)\s/.exec(line);
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names;
}

/** The required filters that are not in the list, in required order. */
export function missingFilters(filters: readonly string[]): readonly string[] {
  const present = new Set(filters);
  return requiredFilters.filter((name) => !present.has(name));
}

/** The contact-sheet filters that are not in the list, in order. */
export function missingSheetFilters(filters: readonly string[]): readonly string[] {
  const present = new Set(filters);
  return sheetFilters.filter((name) => !present.has(name));
}

/** The required encoders that are not in the list, in required order. */
export function missingEncoders(encoders: readonly string[]): readonly string[] {
  const present = new Set(encoders);
  return requiredEncoders.filter((name) => !present.has(name));
}

/** The optional encoders that are not in the list, in order. */
export function missingOptionalEncoders(encoders: readonly string[]): readonly string[] {
  const present = new Set(encoders);
  return optionalEncoders.filter((name) => !present.has(name));
}

/** The label a run of the executable carries in errors and logs: its file name without the extension (`ffmpeg`, `ffprobe`). */
export function queryLabel(executable: string): string {
  return basename(executable, extname(executable)).toLowerCase();
}

/** Runs the ffmpeg-family program with the given arguments and returns its result, or undefined when it did not exit 0. */
async function query(runner: ProcessRunner, executable: string, args: readonly string[], signal: AbortSignal): Promise<ProcessResult | undefined> {
  const result = await runner.run({ label: queryLabel(executable), executable, args, timeoutMs: queryTimeoutMs }, signal);
  return result.exitCode === 0 && !result.timedOut ? result : undefined;
}

/** The version token of the ffmpeg (or ffprobe) at the path, or undefined when it does not run or prints nothing recognizable. */
export async function ffmpegVersion(runner: ProcessRunner, executable: string, signal: AbortSignal): Promise<string | undefined> {
  const result = await query(runner, executable, ['-version'], signal);
  return result === undefined ? undefined : parseFfmpegVersion(result.stdout);
}

/** The filter names the ffmpeg at the path offers; empty when it does not run. */
export async function ffmpegFilters(runner: ProcessRunner, executable: string, signal: AbortSignal): Promise<readonly string[]> {
  const result = await query(runner, executable, ['-hide_banner', '-filters'], signal);
  return result === undefined ? [] : parseFilterNames(result.stdout);
}

/** The encoder names the ffmpeg at the path offers; empty when it does not run. */
export async function ffmpegEncoders(runner: ProcessRunner, executable: string, signal: AbortSignal): Promise<readonly string[]> {
  const result = await query(runner, executable, ['-hide_banner', '-encoders'], signal);
  return result === undefined ? [] : parseEncoderNames(result.stdout);
}

/** The install advice every ffmpeg gap sentence ends with. */
export const fullBuildAdvice = 'install a full build (Gyan.FFmpeg on Windows, Homebrew ffmpeg on macOS, the distribution package on Linux)';

/** Problem sentences for an ffmpeg build that lacks required filters, required encoders or the contact-sheet filters; empty when it has them all. */
export function describeFfmpegGaps(filters: readonly string[], encoders: readonly string[]): readonly string[] {
  const problems: string[] = [];
  const filterGaps = missingFilters(filters);
  if (filterGaps.length > 0) problems.push(`ffmpeg is missing the required filter${filterGaps.length === 1 ? '' : 's'} ${filterGaps.join(', ')}; ${fullBuildAdvice}.`);
  const encoderGaps = missingEncoders(encoders);
  if (encoderGaps.length > 0) problems.push(`ffmpeg is missing the required encoder${encoderGaps.length === 1 ? '' : 's'} ${encoderGaps.join(', ')}; install a build with libx264, aac and pcm_s16le.`);
  const sheetGaps = missingSheetFilters(filters);
  if (sheetGaps.length > 0) problems.push(`ffmpeg is missing the filter${sheetGaps.length === 1 ? '' : 's'} ${sheetGaps.join(', ')} that contact sheets (sheet) need; the lanes still run, but ${fullBuildAdvice} before reviewing stills.`);
  return problems;
}
