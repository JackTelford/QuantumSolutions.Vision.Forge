/**
 * The duration table of
 * skills/cinematic-studio/references/motion/easing-grammar.md as data, the
 * conversion from milliseconds to whole frames, the entrance-overlap rule
 * and the quiet-tail rule before a cut. Pure arithmetic: runs in Node and
 * the browser.
 */

/** A duration band in milliseconds, inclusive at both ends. */
export interface DurationBandMs {
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * How long each class of element animates, in milliseconds: small (icons,
 * labels, highlights), medium (cards, lower thirds, diagram nodes),
 * fullScreen (titles, scene changes, charts building) and the stagger
 * between siblings (the words of a tagline). The camera is the exception:
 * it animates for its move window or the whole shot.
 */
export const durationTable = {
  small: { minMs: 150, maxMs: 250 },
  medium: { minMs: 300, maxMs: 400 },
  fullScreen: { minMs: 450, maxMs: 600 },
  staggerBetweenSiblings: { minMs: 40, maxMs: 80 },
} as const;

/** The classes of the duration table. */
export type DurationClass = keyof typeof durationTable;

/** Nothing except the camera animates for longer than this, in milliseconds. */
export const maxNonCameraDurationMs = 600;

/** Entrances overlap by this fraction of their duration: the next one starts when the previous is 70 percent done. */
export const entranceOverlapFraction = 0.3;

/** Nothing animates in this many frames before a cut, except an exit that completes at the cut. */
export const quietTailFrames = 10;

/** Whether `ms` lies inside the band of its class (inclusive at both ends). */
export function isWithinDurationClass(ms: number, durationClass: DurationClass): boolean {
  const band: DurationBandMs = durationTable[durationClass];
  return ms >= band.minMs && ms <= band.maxMs;
}

/** The whole frames that cover `ms` milliseconds at `fps`: ms × fps / 1000 rounded to the nearest frame, and at least 1 so every animation has a frame. */
export function durationFrames(ms: number, fps: number): number {
  return Math.max(1, Math.round((ms * fps) / 1000));
}

/** How many frames of an entrance the next entrance overlaps: 30 percent of its duration, rounded to the nearest frame. */
export function entranceOverlapFrames(entranceDurationFrames: number): number {
  return Math.round(entranceDurationFrames * entranceOverlapFraction);
}

/**
 * The frame the next entrance starts on so that it overlaps the previous
 * one by 30 percent: the previous start plus its duration minus the
 * overlap. Three entrances chained this way never queue one after another.
 */
export function nextEntranceStartFrame(previousStartFrame: number, previousDurationFrames: number): number {
  return previousStartFrame + previousDurationFrames - entranceOverlapFrames(previousDurationFrames);
}

/**
 * The quiet-tail check: a segment whose exclusive end frame is
 * `segmentEndFrame` still animates on frame segmentEndFrame − 1, and the
 * last 10 frames of a shot of `shotDurationFrames` frames are
 * shotDurationFrames − 10 to shotDurationFrames − 1. A non-exit violates
 * the rule when it animates on any of them (segmentEndFrame > shotDurationFrames − 10);
 * an exit may run into the tail but must complete at the cut
 * (segmentEndFrame ≤ shotDurationFrames).
 */
export function violatesQuietTail(segmentEndFrame: number, shotDurationFrames: number, isExit = false): boolean {
  if (isExit) return segmentEndFrame > shotDurationFrames;
  return segmentEndFrame > shotDurationFrames - quietTailFrames;
}
