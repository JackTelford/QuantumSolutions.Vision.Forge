/**
 * hero-still-match: the approved still against frame k of the render, the
 * strict same-fingerprint comparison of ADR 0006. Both pictures are taken
 * to planar RGB before the ssim filter so that a PNG still and a yuv420p
 * delivery are compared in the same space; the threshold is 0.98.
 */
import { basename } from 'node:path';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { Check } from '../shared/contracts/qa-report.ts';
import { makeCheck, round, runAnalysis, unmeasured } from './check.ts';
import { parseSsimSummary } from './parse.ts';

/** The SSIM below which the rendered frame no longer matches the approved still. */
export const heroStillThreshold = 0.98;

/** The ffmpeg arguments that compare a still with frame `frame` of a video (or a frames pattern) and print the SSIM summary. */
export function heroStillArgs(stillPath: string, videoPath: string, frame: number): readonly string[] {
  return ['-i', stillPath, '-i', videoPath, '-filter_complex', `[0:v]format=gbrp[a];[1:v]select=eq(n\\,${frame}),format=gbrp[b];[a][b]ssim`];
}

/** Runs the comparison and judges it; a frame the video does not have is a failed check with a null measurement. The frame is listed only when the check fails. */
export async function checkHeroStillMatch(runner: ProcessRunner, ffmpegPath: string, stillPath: string, videoPath: string, frame: number, signal: AbortSignal): Promise<Check> {
  try {
    const result = await runAnalysis(runner, ffmpegPath, heroStillArgs(stillPath, videoPath, frame), 'ffmpeg ssim', signal);
    const ssim = parseSsimSummary(result.stderr);
    if (ssim === undefined) {
      return makeCheck('hero-still-match', { ok: false, measured: null, threshold: heroStillThreshold, unit: 'ssim', detail: `frame ${frame} was not found in ${basename(videoPath)}`, frames: [frame] });
    }
    const ok = ssim >= heroStillThreshold;
    return makeCheck('hero-still-match', {
      ok,
      measured: round(ssim, 4),
      threshold: heroStillThreshold,
      unit: 'ssim',
      detail: ok
        ? `frame ${frame} of ${basename(videoPath)} matches ${basename(stillPath)} (SSIM ${round(ssim, 4)})`
        : `frame ${frame} of ${basename(videoPath)} differs from ${basename(stillPath)}: SSIM ${round(ssim, 4)} is below ${heroStillThreshold}`,
      frames: ok ? [] : [frame],
    });
  } catch (error: unknown) {
    return unmeasured('hero-still-match', 'ssim', heroStillThreshold, error);
  }
}
