/**
 * One frame of a video as a PNG, by frame number. Used by the text-contrast
 * check and by tests that build a hero still from a render.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ProcessRunner } from '../process/process-runner.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';

/** The ffmpeg arguments that write frame `frame` (counted from 0) of a video to a PNG. */
export function extractFrameArgs(videoPath: string, frame: number, outputPath: string): readonly string[] {
  return ['-nostats', '-y', '-i', videoPath, '-vf', `select=eq(n\\,${frame})`, '-fps_mode', 'passthrough', '-frames:v', '1', outputPath];
}

/** The ffmpeg arguments that write every `every`th frame of a video (frames 0, every, 2·every, ...) as PNGs numbered from 1 under `pattern`. */
export function extractEveryNthArgs(videoPath: string, every: number, pattern: string): readonly string[] {
  return ['-nostats', '-y', '-i', videoPath, '-vf', `select=not(mod(n\\,${every}))`, '-fps_mode', 'vfr', pattern];
}

/**
 * Writes every `every`th frame of the video into `dir` as f000001.png,
 * f000002.png, ... and returns their paths in order with the frame number
 * each one shows; an empty list when the video has no frames.
 */
export async function extractEveryNth(runner: ProcessRunner, ffmpegPath: string, videoPath: string, every: number, dir: string, signal: AbortSignal): Promise<readonly { readonly path: string; readonly frame: number }[]> {
  if (!Number.isInteger(every) || every < 1) throw new RangeError(`every must be a whole number of frames, 1 or more, not ${String(every)}.`);
  await runFfmpeg(runner, ffmpegPath, extractEveryNthArgs(videoPath, every, join(dir, 'f%06d.png')), { label: 'ffmpeg frame extract', failureHint: `Check that ${videoPath} decodes with ffmpeg.` }, signal);
  return readdirSync(dir).filter((name) => /^f\d{6}\.png$/.test(name)).sort().map((name, index) => ({ path: join(dir, name), frame: index * every }));
}

/**
 * Writes frame `frame` of the video to `outputPath`. Returns false when the
 * video has no such frame (ffmpeg then writes nothing); throws
 * ProcessFailedError when the video does not decode.
 */
export async function extractFrame(runner: ProcessRunner, ffmpegPath: string, videoPath: string, frame: number, outputPath: string, signal: AbortSignal): Promise<boolean> {
  rmSync(outputPath, { force: true });
  await runFfmpeg(runner, ffmpegPath, extractFrameArgs(videoPath, frame, outputPath), { label: 'ffmpeg frame extract', failureHint: `Check that ${videoPath} decodes with ffmpeg.` }, signal);
  return existsSync(outputPath);
}
