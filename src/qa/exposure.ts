/**
 * exposure-drift: the average luma (signalstats YAVG) of each clip, or of
 * each second when there is no plan, compared with the range before it. A
 * jump larger than the threshold between two ranges with no transition
 * between them is a drift: the grade or the lighting changed where the
 * audience expects continuity. One ffmpeg run, then a pure judge.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Check } from '../shared/contracts/qa-report.ts';
import { filterPath } from '../tools/ffmpeg.ts';
import type { Analysis } from './check.ts';
import { makeCheck, round, runAnalysis, unmeasured } from './check.ts';
import { parseSignalstatsYavg } from './parse.ts';
import type { PlanContext } from './plan-context.ts';

/** The largest change in average luma (YAVG units, 16 to 235) allowed between consecutive ranges with no transition. */
export const exposureDriftThreshold = 40;

/** A span of frames to average, with the name the detail uses for it. */
export interface ExposureWindow {
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

/** A window with its average luma; NaN when no frame in it was measured. */
export interface ExposureRange extends ExposureWindow {
  readonly mean: number;
}

/** The signalstats graph that prints every frame's YAVG to a file. */
export function exposureFilter(statsPath: string): string {
  return `signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=${filterPath(statsPath)}`;
}

/** One-second windows over a frame count; the last window keeps the remainder. */
export function secondWindows(frameCount: number, fps: number): ExposureWindow[] {
  const size = Math.max(1, Math.round(fps));
  const windows: ExposureWindow[] = [];
  for (let start = 0, index = 1; start < frameCount; start += size, index += 1) {
    windows.push({ label: `second ${index}`, start, end: Math.min(frameCount, start + size) });
  }
  return windows;
}

/** The average of the measured YAVG values inside each window. */
export function windowMeans(yavg: readonly number[], windows: readonly ExposureWindow[]): ExposureRange[] {
  return windows.map((window) => {
    let sum = 0;
    let count = 0;
    for (let frame = window.start; frame < window.end; frame += 1) {
      const value = yavg[frame];
      if (value === undefined || !Number.isFinite(value)) continue;
      sum += value;
      count += 1;
    }
    return { ...window, mean: count === 0 ? Number.NaN : sum / count };
  });
}

/**
 * exposure-drift verdict. `comparable(index)` says whether range `index` and
 * the next one may be compared (false when a transition sits between them).
 */
export function judgeExposureDrift(ranges: readonly ExposureRange[], comparable: (index: number) => boolean): Check {
  const drifts: { readonly from: ExposureRange; readonly to: ExposureRange; readonly difference: number }[] = [];
  let largest = 0;
  let compared = 0;
  for (let index = 1; index < ranges.length; index += 1) {
    const from = ranges[index - 1];
    const to = ranges[index];
    if (from === undefined || to === undefined || !comparable(index - 1)) continue;
    if (!Number.isFinite(from.mean) || !Number.isFinite(to.mean)) continue;
    compared += 1;
    const difference = Math.abs(to.mean - from.mean);
    largest = Math.max(largest, difference);
    if (difference > exposureDriftThreshold) drifts.push({ from, to, difference });
  }
  const first = drifts[0];
  const detail = first === undefined
    ? (compared === 0 ? 'only one range to measure; nothing to compare' : `largest change in average luma between consecutive ranges is ${round(largest, 1)} YAVG`)
    : `${first.to.label} (YAVG ${round(first.to.mean, 1)}) follows ${first.from.label} (YAVG ${round(first.from.mean, 1)}): difference ${round(first.difference, 1)} with no transition between them${drifts.length > 1 ? ` and ${drifts.length - 1} more` : ''}`;
  return makeCheck('exposure-drift', {
    ok: first === undefined,
    measured: compared === 0 ? null : round(largest, 1),
    threshold: exposureDriftThreshold,
    unit: 'YAVG',
    detail,
    frames: drifts.map((drift) => drift.to.start),
  });
}

/** Runs signalstats over the video, averages per clip (plan) or per second (no plan) and judges the result. */
export async function checkExposureDrift(analysis: Analysis, plan: PlanContext | undefined): Promise<Check> {
  const statsPath = join(analysis.workDir, 'exposure-yavg.txt');
  try {
    await runAnalysis(analysis.runner, analysis.ffmpegPath, ['-i', analysis.videoPath, '-vf', exposureFilter(statsPath)], 'ffmpeg signalstats', analysis.signal);
    if (!existsSync(statsPath)) return makeCheck('exposure-drift', { ok: false, measured: null, threshold: exposureDriftThreshold, unit: 'YAVG', detail: 'could not measure: signalstats wrote no values', frames: [] });
    const yavg = parseSignalstatsYavg(readFileSync(statsPath, 'utf8'));
    const windows: ExposureWindow[] = plan === undefined
      ? secondWindows(analysis.probe.frameCount, analysis.probe.fps)
      : plan.clips.map((clip) => ({ label: `clip "${clip.id}"`, start: clip.start, end: clip.end }));
    const comparable = plan === undefined ? (): boolean => true : (index: number): boolean => !plan.transitionAfter.has(index);
    return judgeExposureDrift(windowMeans(yavg, windows), comparable);
  } catch (error: unknown) {
    return unmeasured('exposure-drift', 'YAVG', exposureDriftThreshold, error);
  }
}
