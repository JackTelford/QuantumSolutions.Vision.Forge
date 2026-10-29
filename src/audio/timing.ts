/**
 * Where every sentence of a narration sits in time, from the sample counts
 * the voice returned: sentence k starts after the sentences before it and
 * k gaps of silence, and ends when its samples do. Seconds come from the
 * sample rate; frames from the shot's rate, the start rounded down and the
 * end rounded up so a sentence's frames cover its audio. Frames are computed
 * from the integer sample offsets (offset * fps / rate), never from the
 * rounded seconds: 6720 samples at 24 kHz and 25 fps is exactly 7 frames,
 * but 0.28 * 25 in floating point is a hair over 7 and would ceil to 8. The
 * events feed a
 * `Timeline` (`src/shared/motion/timeline.ts`) so a shot can start a text
 * element when its sentence does. Pure.
 */

/** One sentence's place in time. */
export interface SentenceTiming {
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** The first frame the sentence is heard in. */
  readonly startFrame: number;
  /** The first frame after the sentence (end exclusive). */
  readonly endFrame: number;
}

/** The timings of every sentence and the length of the whole narration. */
export interface NarrationTiming {
  readonly sentences: readonly SentenceTiming[];
  /** Seconds from the first sample to the last, gaps included. */
  readonly totalSeconds: number;
  /** Whole frames that cover the narration at the shot's rate. */
  readonly totalFrames: number;
}

/** The silence between sentences as a whole sample count, rounded to the nearest sample. */
export function gapSampleCount(gapSeconds: number, sampleRate: number): number {
  if (!(gapSeconds >= 0) || !Number.isFinite(gapSeconds)) throw new RangeError(`The gap must be zero or more seconds, not ${String(gapSeconds)}.`);
  return Math.round(gapSeconds * sampleRate);
}

/** The timings of sentences whose samples are `sampleCounts` long, laid end to end with `gapSeconds` of silence between them. */
export function sentenceTimings(sampleCounts: readonly number[], sampleRate: number, gapSeconds: number, fps: number): NarrationTiming {
  if (!(sampleRate > 0)) throw new RangeError(`The sample rate must be positive, not ${String(sampleRate)}.`);
  if (!(fps > 0)) throw new RangeError(`fps must be a positive frame rate, not ${String(fps)}.`);
  const gap = gapSampleCount(gapSeconds, sampleRate);
  const sentences: SentenceTiming[] = [];
  let offset = 0;
  sampleCounts.forEach((count, index) => {
    if (!Number.isInteger(count) || count < 0) throw new RangeError(`Sentence ${String(index + 1)} has a sample count of ${String(count)}; it must be a non-negative integer.`);
    if (index > 0) offset += gap;
    sentences.push({
      startSeconds: offset / sampleRate,
      endSeconds: (offset + count) / sampleRate,
      startFrame: Math.floor((offset * fps) / sampleRate),
      endFrame: Math.ceil(((offset + count) * fps) / sampleRate),
    });
    offset += count;
  });
  return { sentences, totalSeconds: offset / sampleRate, totalFrames: Math.ceil((offset * fps) / sampleRate) };
}

/** The named frame events a `Timeline` takes: `sentence-1-start`, `sentence-1-end`, ... numbered from 1 in order. */
export function timelineEvents(timing: NarrationTiming): Record<string, number> {
  const events: Record<string, number> = {};
  timing.sentences.forEach((sentence, index) => {
    events[`sentence-${String(index + 1)}-start`] = sentence.startFrame;
    events[`sentence-${String(index + 1)}-end`] = sentence.endFrame;
  });
  return events;
}
