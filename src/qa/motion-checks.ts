/**
 * The three checks that read the picture over time: black-frames
 * (blackdetect), frozen-frames (freezedetect) and pops (the SSIM between
 * each frame and the one before it). Each one runs ffmpeg once and hands
 * the parsed numbers to a pure judge, so the verdicts are testable without
 * a video. The plan, when there is one, says which black frames, holds and
 * cuts were intended.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Check } from '../shared/contracts/qa-report.ts';
import { filterPath } from '../tools/ffmpeg.ts';
import type { Analysis, FrameRange } from './check.ts';
import { describeFrameRuns, describeFrames, frameToSecondsText, framesOutside, makeCheck, rangeWithin, round, runAnalysis, secondsToFrame, unmeasured } from './check.ts';
import { parseBlackdetect, parseFreezedetect, parseSsimStats } from './parse.ts';
import type { TimeSegment } from './parse.ts';
import { clipTailRanges } from './plan-context.ts';
import type { PlanContext } from './plan-context.ts';

/** blackdetect as the check runs it: segments of at least 0.1 s where 98 % of pixels are under 10 % luma. */
export const blackdetectFilter = 'blackdetect=d=0.1:pic_th=0.98:pix_th=0.10';

/**
 * A hold this long at the end of a clip is a planned still, not a frozen
 * render. It is also freezedetect's minimum (the `d` of freezedetectFilter),
 * on purpose: the detector reports a hold of exactly `d` seconds as exactly
 * that many frames, so the tolerated tail of a clip admits a hold of up to
 * `d` and nothing longer. Change this and both move together.
 */
export const stillHoldSeconds = 0.5;

/** freezedetect as the check runs it: frames within -60 dB of the previous one for at least stillHoldSeconds. */
export const freezedetectFilter = `freezedetect=n=-60dB:d=${stillHoldSeconds}`;

/** The adjacent-frame SSIM below which a frame is a pop unless a cut was planned there. */
export const popSsimThreshold = 0.6;

/** The filter graph that compares every frame with the frame before it (the first with itself) and writes per-frame SSIM to the stats file. */
export function adjacentSsimGraph(statsPath: string): string {
  return `[0:v]split[a][b];[b]tpad=start=1:start_mode=clone[c];[a][c]ssim=stats_file=${filterPath(statsPath)}`;
}

function toFrameRanges(segments: readonly TimeSegment[], fps: number): FrameRange[] {
  return segments
    .map((segment) => ({ start: secondsToFrame(segment.start, fps), end: secondsToFrame(segment.end, fps) }))
    .filter((range) => range.end > range.start);
}

/** black-frames verdict: every black frame outside an allowed range (a planned fade to black) is flagged; the detail names each segment's flagged runs. */
export function judgeBlackFrames(segments: readonly TimeSegment[], fps: number, allowed: readonly FrameRange[]): Check {
  const flagged: { readonly first: number; readonly count: number; readonly text: string }[] = [];
  for (const range of toFrameRanges(segments, fps)) {
    const frames = framesOutside(range, allowed);
    const first = frames[0];
    if (first === undefined) continue;
    flagged.push({ first, count: frames.length, text: describeFrameRuns(frames) });
  }
  const total = flagged.reduce((sum, entry) => sum + entry.count, 0);
  const detail = total === 0
    ? (segments.length === 0 ? 'no black frames' : `no black frames outside the ${allowed.length} planned fade-black transition(s)`)
    : `${total} black frame(s) in ${flagged.length} segment(s): ${flagged.map((entry) => entry.text).join(', ')}`;
  return makeCheck('black-frames', { ok: total === 0, measured: total, threshold: 0, unit: 'frames', detail, frames: flagged.map((entry) => entry.first) });
}

/** frozen-frames verdict: a freeze is flagged unless it lies entirely inside a tolerated range (the last half second of a clip). */
export function judgeFrozenFrames(segments: readonly TimeSegment[], fps: number, tolerated: readonly FrameRange[]): Check {
  const flagged = toFrameRanges(segments, fps).filter((range) => !tolerated.some((hold) => rangeWithin(range, hold)));
  const total = flagged.reduce((sum, range) => sum + (range.end - range.start), 0);
  const detail = total === 0
    ? (segments.length === 0 ? 'no frozen frames' : `no frozen frames outside the planned ${stillHoldSeconds} s holds at clip ends (${segments.length} hold(s) seen)`)
    : flagged.map((range) => `${describeFrames(range)} are frozen (${frameToSecondsText(range.end - range.start, fps)})`).join('; ');
  return makeCheck('frozen-frames', { ok: total === 0, measured: total, threshold: 0, unit: 'frames', detail, frames: flagged.map((range) => range.start) });
}

/** pops verdict: a frame whose SSIM against the previous frame is under the threshold, and that is not within one frame of a planned cut, is a pop. */
export function judgePops(ssims: readonly number[], cutFrames: readonly number[]): Check {
  const pops: { readonly frame: number; readonly ssim: number }[] = [];
  let lowest: { readonly frame: number; readonly ssim: number } | undefined;
  ssims.forEach((ssim, frame) => {
    if (!Number.isFinite(ssim)) return;
    if (cutFrames.some((cut) => Math.abs(cut - frame) <= 1)) return;
    if (lowest === undefined || ssim < lowest.ssim) lowest = { frame, ssim };
    if (ssim < popSsimThreshold) pops.push({ frame, ssim });
  });
  const first = pops[0];
  const detail = first === undefined
    ? (lowest === undefined ? 'no frame pairs to compare' : `lowest adjacent-frame SSIM ${round(lowest.ssim, 4)} at frame ${lowest.frame}; no pops${cutFrames.length > 0 ? ` (${cutFrames.length} planned cut(s) excluded)` : ''}`)
    : `frame ${first.frame} differs from frame ${first.frame - 1} (SSIM ${round(first.ssim, 4)}) with no planned cut there${pops.length > 1 ? ` and ${pops.length - 1} more` : ''}`;
  return makeCheck('pops', {
    ok: first === undefined,
    measured: lowest === undefined ? null : round(lowest.ssim, 4),
    threshold: popSsimThreshold,
    unit: 'ssim',
    detail,
    frames: pops.map((pop) => pop.frame),
  });
}

/** Runs blackdetect on the video and judges the result. */
export async function checkBlackFrames(analysis: Analysis, plan: PlanContext | undefined): Promise<Check> {
  try {
    const result = await runAnalysis(analysis.runner, analysis.ffmpegPath, ['-i', analysis.videoPath, '-vf', blackdetectFilter], 'ffmpeg blackdetect', analysis.signal);
    return judgeBlackFrames(parseBlackdetect(result.stderr), analysis.probe.fps, plan?.fadeBlackRanges ?? []);
  } catch (error: unknown) {
    return unmeasured('black-frames', 'frames', 0, error);
  }
}

/** Runs freezedetect on the video and judges the result. */
export async function checkFrozenFrames(analysis: Analysis, plan: PlanContext | undefined): Promise<Check> {
  try {
    const result = await runAnalysis(analysis.runner, analysis.ffmpegPath, ['-i', analysis.videoPath, '-vf', freezedetectFilter], 'ffmpeg freezedetect', analysis.signal);
    const streamEnd = analysis.probe.frameCount / analysis.probe.fps;
    return judgeFrozenFrames(parseFreezedetect(result.stderr, streamEnd), analysis.probe.fps, plan === undefined ? [] : clipTailRanges(plan, stillHoldSeconds));
  } catch (error: unknown) {
    return unmeasured('frozen-frames', 'frames', 0, error);
  }
}

/** Runs the adjacent-frame SSIM graph on the video and judges the result. */
export async function checkPops(analysis: Analysis, plan: PlanContext | undefined): Promise<Check> {
  const statsPath = join(analysis.workDir, 'pops-ssim.txt');
  try {
    await runAnalysis(analysis.runner, analysis.ffmpegPath, ['-i', analysis.videoPath, '-filter_complex', adjacentSsimGraph(statsPath)], 'ffmpeg ssim', analysis.signal);
    if (!existsSync(statsPath)) return makeCheck('pops', { ok: false, measured: null, threshold: popSsimThreshold, unit: 'ssim', detail: 'could not measure: the ssim filter wrote no stats file', frames: [] });
    const ssims = parseSsimStats(readFileSync(statsPath, 'utf8')).slice(0, analysis.probe.frameCount);
    return judgePops(ssims, plan?.cutFrames ?? []);
  } catch (error: unknown) {
    return unmeasured('pops', 'ssim', popSsimThreshold, error);
  }
}
