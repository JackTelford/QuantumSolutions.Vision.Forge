/**
 * How long on-screen text stays and when captions appear around narration:
 * the reading hold of composition/rules.md and the caption lead and tail of
 * editing/pacing-and-transitions.md, as pure functions. Runs in Node and
 * the browser.
 */
import { secondsToFrames } from '../frame-time.ts';

/** Seconds of reading time per word. */
export const secondsPerWord = 0.3;

/** Seconds added to every reading hold so even one word is on screen long enough to be seen. */
export const readingHoldBaseSeconds = 0.8;

/** The shortest hold, in seconds, for text that contains a number (a statistic the viewer has to take in). */
export const numericHoldFloorSeconds = 2;

/** Captions appear this many frames before their narration sentence starts (the grammar allows 6 to 10; 8 is the house value). */
export const captionLeadFrames = 8;

/** The band the grammar allows for the caption lead, in frames. */
export const captionLeadFramesRange: { readonly min: number; readonly max: number } = { min: 6, max: 10 };

/** Captions leave this many frames after their narration sentence ends. */
export const captionTailFrames = 6;

/** The frames a caption occupies around its sentence: inFrame (inclusive) and outFrame (exclusive). */
export interface CaptionWindow {
  readonly inFrame: number;
  readonly outFrame: number;
}

const whitespace = /\s+/;
/** Any decimal digit of any script (Unicode category Nd): ASCII, Arabic-Indic, Devanagari and the rest. */
const digit = /\p{Nd}/u;

/** Number of words in `text`: runs of non-whitespace characters; an empty or blank string has none. */
export function wordCount(text: string): number {
  return text.split(whitespace).filter((word) => word.length > 0).length;
}

/** Whether the text contains a digit, which makes it a number or statistic for the reading hold. */
export function containsNumber(text: string): boolean {
  return digit.test(text);
}

/**
 * The reading hold in seconds: words × 0.3 + 0.8, and at least 2 when the
 * text contains a number. A ten-word line holds 3.8 s; "42 percent" holds
 * 2 s instead of its arithmetic 1.4 s.
 */
export function readingHoldSeconds(text: string): number {
  const hold = wordCount(text) * secondsPerWord + readingHoldBaseSeconds;
  return containsNumber(text) ? Math.max(hold, numericHoldFloorSeconds) : hold;
}

/** The reading hold as whole frames at `fps`: the seconds rounded to the nearest frame. */
export function readingHoldFrames(text: string, fps: number): number {
  return secondsToFrames(readingHoldSeconds(text), fps);
}

/**
 * When a caption is on screen for a sentence spoken from
 * `sentenceStartFrame` (inclusive) to `sentenceEndFrame` (exclusive): it
 * enters 8 frames before the sentence (never before frame 0) and leaves
 * 6 frames after it.
 */
export function captionWindow(sentenceStartFrame: number, sentenceEndFrame: number): CaptionWindow {
  return { inFrame: Math.max(0, sentenceStartFrame - captionLeadFrames), outFrame: sentenceEndFrame + captionTailFrames };
}
