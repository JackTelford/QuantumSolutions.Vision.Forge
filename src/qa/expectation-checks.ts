/**
 * The three checks that compare what ffprobe measured with what was
 * expected: dimensions, fps and duration. The expectation comes from the
 * plan or from explicit values; without one the check records the
 * measurement, passes, and says so. Pure: the probe already ran.
 */
import type { Check } from '../shared/contracts/qa-report.ts';
import { frameToSecondsText, makeCheck } from './check.ts';
import type { PlanContext } from './plan-context.ts';
import type { VideoProbe } from './probe.ts';

/** What a delivery is expected to be; every field is optional. */
export interface Expectations {
  /** Expected width in pixels. */
  readonly width?: number;
  /** Expected height in pixels. */
  readonly height?: number;
  /** Expected frames per second. */
  readonly fps?: number;
  /** Expected length in frames. */
  readonly frames?: number;
}

/** Frame rates within this of each other count as equal (29.97 against 30000/1001). */
export const fpsTolerance = 0.001;

/** The expectations an assembly plan sets. */
export function expectationsFromPlan(context: PlanContext): Expectations {
  return { width: context.width, height: context.height, fps: context.fps, frames: context.totalFrames };
}

/** dimensions: width and height against the expectation; measured and threshold carry the width, the detail both. */
export function checkDimensions(probe: VideoProbe, expected: Expectations): Check {
  const measuredText = `${probe.width}x${probe.height}`;
  if (expected.width === undefined || expected.height === undefined) {
    return makeCheck('dimensions', { ok: true, measured: probe.width, threshold: null, unit: 'px', detail: `measured ${measuredText}; no expectation`, frames: [] });
  }
  const ok = probe.width === expected.width && probe.height === expected.height;
  const expectedText = `${expected.width}x${expected.height}`;
  return makeCheck('dimensions', {
    ok,
    measured: probe.width,
    threshold: expected.width,
    unit: 'px',
    detail: ok ? `measured ${measuredText} as expected` : `measured ${measuredText}, expected ${expectedText}`,
    frames: [],
  });
}

/** fps: the stream's r_frame_rate against the expectation, within fpsTolerance. */
export function checkFps(probe: VideoProbe, expected: Expectations): Check {
  const measured = Math.round(probe.fps * 1000) / 1000;
  if (expected.fps === undefined) {
    return makeCheck('fps', { ok: true, measured, threshold: null, unit: 'fps', detail: `measured ${measured} fps; no expectation`, frames: [] });
  }
  const ok = Math.abs(probe.fps - expected.fps) <= fpsTolerance;
  return makeCheck('fps', {
    ok,
    measured,
    threshold: expected.fps,
    unit: 'fps',
    detail: ok ? `measured ${measured} fps as expected` : `measured ${measured} fps, expected ${expected.fps} fps`,
    frames: [],
  });
}

/** duration: the decoded frame count against the expected frame count, exactly. */
export function checkDuration(probe: VideoProbe, expected: Expectations): Check {
  const seconds = frameToSecondsText(probe.frameCount, probe.fps);
  if (expected.frames === undefined) {
    return makeCheck('duration', { ok: true, measured: probe.frameCount, threshold: null, unit: 'frames', detail: `measured ${probe.frameCount} frames (${seconds}); no expectation`, frames: [] });
  }
  const ok = probe.frameCount === expected.frames;
  return makeCheck('duration', {
    ok,
    measured: probe.frameCount,
    threshold: expected.frames,
    unit: 'frames',
    detail: ok ? `measured ${probe.frameCount} frames (${seconds}) as expected` : `measured ${probe.frameCount} frames (${seconds}), expected ${expected.frames} frames (${frameToSecondsText(expected.frames, probe.fps)})`,
    frames: [],
  });
}
