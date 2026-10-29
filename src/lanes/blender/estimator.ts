/**
 * The time estimate of a Blender render: the first batch of a run is kept
 * short (three frames) and timed, and the seconds per frame it measured
 * are multiplied by the frames still to render. The measurement includes
 * the per-process cost every batch pays (Blender's start, EEVEE's shader
 * compile), spread over the batch's frames, so a three-frame batch
 * overstates the cost of a thirty-frame one; the estimate is a ceiling, as
 * an estimate shown before a long render should be. Pure.
 */

/** How many frames the estimate batch renders. */
export const estimateBatchFrames = 3;

/** What the render command reports: the measured cost and the projected total. */
export interface RenderEstimate {
  /** Seconds per frame measured on the estimate batch, rounded to a tenth. */
  readonly secondsPerFrame: number;
  /** Seconds the remaining frames are projected to take at that rate, rounded to whole seconds. */
  readonly totalSeconds: number;
}

/** The estimate from a timed batch: elapsed milliseconds over the frames it rendered, projected over the frames that remain. */
export function estimateFromBatch(elapsedMs: number, batchFrames: number, remainingFrames: number): RenderEstimate {
  if (batchFrames <= 0) throw new RangeError('An estimate needs a batch of at least one frame.');
  const secondsPerFrame = elapsedMs / 1000 / batchFrames;
  return {
    secondsPerFrame: Math.round(secondsPerFrame * 10) / 10,
    totalSeconds: Math.round(secondsPerFrame * Math.max(0, remainingFrames)),
  };
}

/** The estimate for one render combined into a job's: the frame-weighted mean rate and the summed total; null when no shot was estimated. */
export function combineEstimates(estimates: readonly { readonly estimate: RenderEstimate; readonly frames: number }[]): RenderEstimate | null {
  const counted = estimates.filter((entry) => entry.frames > 0);
  if (counted.length === 0) return null;
  const frames = counted.reduce((sum, entry) => sum + entry.frames, 0);
  const weighted = counted.reduce((sum, entry) => sum + entry.estimate.secondsPerFrame * entry.frames, 0);
  return {
    secondsPerFrame: Math.round((weighted / frames) * 10) / 10,
    totalSeconds: counted.reduce((sum, entry) => sum + entry.estimate.totalSeconds, 0),
  };
}
