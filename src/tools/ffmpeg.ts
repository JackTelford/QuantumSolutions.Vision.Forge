/**
 * ffmpeg and ffprobe as external programs: where they are, how arguments are
 * quoted inside filter graphs, and one function that runs them and turns a
 * non-zero exit into an actionable error.
 */
import { dirname, join } from 'node:path';
import { ProcessFailedError, ProcessTimeoutError, ToolMissingError } from '../errors/vision-forge-error.ts';
import type { ProcessResult, ProcessRunner } from '../process/process-runner.ts';
import { stderrTail } from '../process/process-runner.ts';
import { findProgram, isRunnableFile } from './find-program.ts';
import type { FoundProgram } from './find-program.ts';

/** Environment variable that overrides ffmpeg discovery (ffprobe is taken from the same folder). */
export const ffmpegEnvironmentVariable = 'FFMPEG';

/** Install hints per platform, printed by doctor and carried by ToolMissingError. */
export const ffmpegInstallHint: Readonly<Record<string, string>> = {
  win32: 'Install it with: winget install --id Gyan.FFmpeg --exact (then open a new terminal), or set FFMPEG to the full path of ffmpeg.exe.',
  darwin: 'Install it with: brew install ffmpeg, or set FFMPEG to the full path of ffmpeg.',
  linux: 'Install it with: sudo apt install ffmpeg (or your distribution\'s package), or set FFMPEG to the full path of ffmpeg.',
};

/** The hint for the current platform. */
export function ffmpegHint(platform: NodeJS.Platform = process.platform): string {
  return ffmpegInstallHint[platform] ?? ffmpegInstallHint['linux'] ?? '';
}

/** Folders ffmpeg is commonly installed in when it is not on PATH. */
export function knownFfmpegPaths(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): readonly string[] {
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA'];
    const programFiles = env['ProgramFiles'];
    const candidates: string[] = [];
    if (programFiles !== undefined) candidates.push(join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'));
    if (local !== undefined) candidates.push(join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
    candidates.push('C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe');
    return candidates;
  }
  if (platform === 'darwin') return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  return ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/snap/bin/ffmpeg'];
}

/** Finds ffmpeg, or undefined. */
export function findFfmpeg(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): FoundProgram | undefined {
  return findProgram('ffmpeg', ffmpegEnvironmentVariable, knownFfmpegPaths(env, platform), env, platform);
}

/** Finds ffprobe next to ffmpeg, or on PATH; undefined when absent. */
export function findFfprobe(ffmpegPath: string | undefined, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): FoundProgram | undefined {
  if (ffmpegPath !== undefined) {
    const sibling = join(dirname(ffmpegPath), platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (isRunnableFile(sibling)) return { path: sibling, foundBy: 'known-folder' };
  }
  return findProgram('ffprobe', 'FFPROBE', [], env, platform);
}

/** Finds ffmpeg or throws ToolMissingError with the platform's install hint. */
export function requireFfmpeg(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): string {
  const found = findFfmpeg(env, platform);
  if (found === undefined) throw new ToolMissingError('ffmpeg', ffmpegHint(platform));
  return found.path;
}

/** Finds ffprobe or throws ToolMissingError with the platform's install hint. */
export function requireFfprobe(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): string {
  const found = findFfprobe(findFfmpeg(env, platform)?.path, env, platform);
  if (found === undefined) throw new ToolMissingError('ffprobe', ffmpegHint(platform));
  return found.path;
}

/**
 * Quotes a file path for use inside an ffmpeg filter option (`lut3d=file=...`,
 * `drawtext=fontfile=...`, `subtitles=...`). ffmpeg parses a filter graph at
 * two levels: single quotes protect the value from the graph parser, and
 * `\:` protects the colon from the option parser. Backslashes become forward
 * slashes, which Windows accepts; an apostrophe closes and reopens the quotes.
 */
export function filterPath(path: string): string {
  const forward = path.replace(/\\/g, '/').replace(/:/g, '\\:');
  return `'${forward.replace(/'/g, "'\\''")}'`;
}

/** A file path as ffmpeg expects it in a concat list: forward slashes, single quotes escaped. */
export function concatListPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

/** What runFfmpeg needs beyond the arguments. */
export interface FfmpegRunOptions {
  readonly label: string;
  readonly timeoutMs?: number;
  readonly cwd?: string;
  readonly stdin?: Uint8Array;
  readonly stderrFile?: string;
  /** The hint carried by ProcessFailedError; defaults to a generic one. */
  readonly failureHint?: string;
}

/** Runs ffmpeg or ffprobe (`-hide_banner` is added) and throws ProcessFailedError or ProcessTimeoutError when it fails. */
export async function runFfmpeg(runner: ProcessRunner, executable: string, args: readonly string[], options: FfmpegRunOptions, signal: AbortSignal): Promise<ProcessResult> {
  const spec = {
    label: options.label,
    executable,
    args: ['-hide_banner', ...args],
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    ...(options.stderrFile === undefined ? {} : { stderrFile: options.stderrFile }),
  };
  const result = await runner.run(spec, signal);
  if (result.timedOut) throw new ProcessTimeoutError(options.label, options.timeoutMs ?? 0);
  if (result.exitCode !== 0) {
    throw new ProcessFailedError(options.label, result.exitCode, stderrTail(result.stderr), options.stderrFile, options.failureHint ?? 'Run the command again with --verbose to see the full ffmpeg output.');
  }
  return result;
}
