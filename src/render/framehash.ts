/**
 * Pixel hashes of rendered frames through ffmpeg's framehash muxer (ADR
 * 0006 decision 5): SHA-256 of the decoded pixels, never of the PNG bytes,
 * so two encoders that write the same picture agree. One ffmpeg run hashes
 * each contiguous run of frame numbers through the image2 demuxer's printf
 * pattern; ffmpeg numbers the output by presentation timestamp from 0, so
 * timestamp i of a run that starts at frame f is frame f + i.
 *
 * The output format, recorded against ffmpeg 9.0.2: comment lines start
 * with `#`; every other line is `stream, dts, pts, duration, size, hash`,
 * the fields separated by a comma and spaces.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';
import { framePattern } from './cache.ts';

/** A run of consecutive frame numbers. */
export interface FrameRun {
  readonly first: number;
  readonly count: number;
}

/** The hash column must be a SHA-256 digest in lowercase hex. */
const hashPattern = /^[0-9a-f]{64}$/;

/** The frames as contiguous runs in ascending order, each frame once. */
export function frameRuns(frames: readonly number[]): readonly FrameRun[] {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  const runs: FrameRun[] = [];
  for (const frame of sorted) {
    const last = runs[runs.length - 1];
    if (last !== undefined && frame === last.first + last.count) runs[runs.length - 1] = { first: last.first, count: last.count + 1 };
    else runs.push({ first: frame, count: 1 });
  }
  return runs;
}

/** The ffmpeg arguments (after -hide_banner) that hash `count` frames of a printf pattern starting at `first`. */
export function framehashArgs(pattern: string, run: FrameRun): readonly string[] {
  // -framerate 1 makes the presentation timestamps 0, 1, 2, ... so the pts column is the frame's offset in the run.
  return ['-loglevel', 'error', '-framerate', '1', '-start_number', String(run.first), '-i', pattern, '-frames:v', String(run.count), '-f', 'framehash', '-hash', 'sha256', '-'];
}

/** The hashes in framehash's output keyed by presentation timestamp; lines that are comments or do not parse are skipped. */
export function parseFramehash(stdout: string): ReadonlyMap<number, string> {
  const hashes = new Map<number, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const fields = trimmed.split(/,\s*/);
    const pts = Number(fields[2]);
    const hash = fields[fields.length - 1] ?? '';
    if (!Number.isInteger(pts) || pts < 0 || !hashPattern.test(hash)) continue;
    hashes.set(pts, hash);
  }
  return hashes;
}

/** A frame could not be hashed: ffmpeg printed no digest for it. */
export class FramehashError extends VisionForgeError {
  readonly frames: readonly number[];

  constructor(framesDirectory: string, frames: readonly number[]) {
    super({
      code: 'framehash',
      message: `ffmpeg framehash printed no hash for frame${frames.length === 1 ? '' : 's'} ${frames.join(', ')} under ${framesDirectory}.`,
      hint: 'A frame PNG is missing or truncated. Run the command again; frames without a hash are rendered again. If it repeats, delete the shot\'s cache folder.',
    });
    this.frames = [...frames];
  }
}

/**
 * The SHA-256 pixel hash of every requested frame under the frames folder,
 * one ffmpeg run per contiguous run of frame numbers. Throws FramehashError
 * when any requested frame comes back without a hash.
 */
export async function hashFrames(runner: ProcessRunner, ffmpegPath: string, framesDirectory: string, frames: readonly number[], signal: AbortSignal): Promise<ReadonlyMap<number, string>> {
  const pattern = framePattern(framesDirectory);
  const hashes = new Map<number, string>();
  for (const run of frameRuns(frames)) {
    const result = await runFfmpeg(runner, ffmpegPath, framehashArgs(pattern, run), {
      label: 'ffmpeg framehash',
      failureHint: `Check that the frames under ${framesDirectory} are readable PNGs; run the command again with --verbose to see the full ffmpeg output.`,
    }, signal);
    for (const [pts, hash] of parseFramehash(result.stdout)) {
      if (pts < run.count) hashes.set(run.first + pts, hash);
    }
  }
  const missing = [...new Set(frames)].filter((frame) => !hashes.has(frame)).sort((a, b) => a - b);
  if (missing.length > 0) throw new FramehashError(framesDirectory, missing);
  return hashes;
}
