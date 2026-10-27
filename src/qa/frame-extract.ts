/**
 * One frame of a video as a PNG, by frame number. Used by the text-contrast
 * check and by tests that build a hero still from a render.
 */
import { existsSync, rmSync } from 'node:fs';
import type { ProcessRunner } from '../process/process-runner.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';

/** The ffmpeg arguments that write frame `frame` (counted from 0) of a video to a PNG. */
export function extractFrameArgs(videoPath: string, frame: number, outputPath: string): readonly string[] {
  return ['-nostats', '-y', '-i', videoPath, '-vf', `select=eq(n\\,${frame})`, '-fps_mode', 'passthrough', '-frames:v', '1', outputPath];
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
