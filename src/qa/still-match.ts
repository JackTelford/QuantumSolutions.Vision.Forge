/**
 * hero-still-match: the approved still against frame k of the render, the
 * strict same-fingerprint comparison of ADR 0006. Frame k is first written
 * to a PNG in the work directory (the same extraction the text-contrast
 * check uses), then the two PNGs are taken to planar RGB and compared with
 * the ssim filter, so a still and a yuv420p delivery meet in one space. Two
 * single-image inputs pair reliably on every ffmpeg version; selecting the
 * frame inside the ssim graph did not (ffmpeg 7.0 paired the still with
 * another frame). The threshold is 0.98.
 */
import { basename, join } from 'node:path';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { Check } from '../shared/contracts/qa-report.ts';
import { makeCheck, round, runAnalysis, unmeasured } from './check.ts';
import { extractFrame } from './frame-extract.ts';
import { parseSsimSummary } from './parse.ts';

/** The SSIM below which the rendered frame no longer matches the approved still. */
export const heroStillThreshold = 0.98;

/** The ffmpeg arguments that compare two PNGs (the still and the extracted frame) in planar RGB and print the SSIM summary. */
export function heroStillArgs(stillPath: string, framePath: string): readonly string[] {
  return ['-i', stillPath, '-i', framePath, '-filter_complex', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim'];
}

/** Where frame `frame` of the video is written for the comparison. */
export function heroFramePath(workDir: string, frame: number): string {
  return join(workDir, `hero-frame-${frame}.png`);
}

/**
 * Extracts frame `frame` into the work directory, compares it with the still
 * and judges the result; a frame the video does not have is a failed check
 * with a null measurement. The frame is listed only when the check fails.
 */
export async function checkHeroStillMatch(runner: ProcessRunner, ffmpegPath: string, stillPath: string, videoPath: string, frame: number, workDir: string, signal: AbortSignal): Promise<Check> {
  try {
    const framePath = heroFramePath(workDir, frame);
    const found = await extractFrame(runner, ffmpegPath, videoPath, frame, framePath, signal);
    if (!found) {
      return makeCheck('hero-still-match', { ok: false, measured: null, threshold: heroStillThreshold, unit: 'ssim', detail: `frame ${frame} was not found in ${basename(videoPath)}`, frames: [frame] });
    }
    const result = await runAnalysis(runner, ffmpegPath, heroStillArgs(stillPath, framePath), 'ffmpeg ssim', signal);
    const ssim = parseSsimSummary(result.stderr);
    if (ssim === undefined) {
      return makeCheck('hero-still-match', { ok: false, measured: null, threshold: heroStillThreshold, unit: 'ssim', detail: `ffmpeg printed no SSIM for frame ${frame} of ${basename(videoPath)} against ${basename(stillPath)}`, frames: [frame] });
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
