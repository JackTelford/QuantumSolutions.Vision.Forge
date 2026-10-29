/**
 * How a Blender render is cut into processes. Blender renders a contiguous
 * frame range per process (frame_start to frame_end), and EEVEE pays about
 * twenty seconds of shader compile per process, so frames go in batches of
 * thirty contiguous frames; the first batch of a run is the three-frame
 * estimate batch (estimator.ts). The frames a run is given are the ones
 * the manifest has no hash for yet (src/render/manifest.ts hashedFrames),
 * so a resumed render skips what it already has, exactly as the browser
 * path does. Pure.
 */
import { frameRuns } from '../../render/framehash.ts';
import { estimateBatchFrames } from './estimator.ts';

/** How many frames one Blender process renders at most. */
export const framesPerBatch = 30;

/** A batch: contiguous frame numbers in ascending order. */
export type FrameBatch = readonly number[];

/** The frames as contiguous runs cut to the batch size; the first batch holds the estimate batch's frames when more than that many are to render. */
export function planBatches(frames: readonly number[], batchSize = framesPerBatch, firstBatchSize = estimateBatchFrames): readonly FrameBatch[] {
  if (batchSize < 1 || firstBatchSize < 1) throw new RangeError('A batch holds at least one frame.');
  const batches: number[][] = [];
  for (const run of frameRuns(frames)) {
    let first = run.first;
    const end = run.first + run.count;
    while (first < end) {
      // Only the whole plan's first batch is the short estimate batch; every later one is a full batch.
      const size = batches.length === 0 && frames.length > firstBatchSize ? firstBatchSize : batchSize;
      const last = Math.min(end, first + size);
      batches.push(Array.from({ length: last - first }, (_, index) => first + index));
      first = last;
    }
  }
  return batches;
}
