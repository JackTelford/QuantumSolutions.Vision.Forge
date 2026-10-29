/**
 * Which frame the still gate judges when the caller names none: the frame
 * where the shot shows the most. With text, that is the first frame on
 * which the last text element has finished entering, so the gate sees every
 * word in place. Without text, the end of the camera move (the last frame
 * inside its window, since endFrame is the first frame of the held end
 * pose), so the gate sees the composition the move lands on. For a static
 * shot without text any frame looks alike; the middle is taken.
 */
import { moveWindow } from '../shared/camera/bake.ts';
import type { Shot, TextElement } from '../shared/contracts/shot-spec.ts';
import { splitWords, textTiming } from '../shared/typography/text-animation.ts';

/** Clamps a frame into the shot's range. */
function clampFrame(shot: Shot, frame: number): number {
  const last = Math.max(0, shot.durationFrames - 1);
  return Math.min(last, Math.max(0, frame));
}

/** The first frame on which every word of the element is in place: stagger-words enters word by word, so its last word sets the end. */
export function elementEnterEnd(element: TextElement, fps: number): number {
  const lastWord = element.animation === 'stagger-words' ? Math.max(0, splitWords(element.content).length - 1) : 0;
  return textTiming(element, fps, lastWord).enterEnd;
}

/** The latest frame on which a text element of the shot has finished entering, or undefined when the shot has no text. */
export function lastTextEnterEnd(shot: Shot, fps: number): number | undefined {
  if (shot.text.length === 0) return undefined;
  return Math.max(...shot.text.map((element) => elementEnterEnd(element, fps)));
}

/** The default still frame of a shot: after the last text entrance, else the end of the move, else the middle; always inside the shot. */
export function defaultStillFrame(shot: Shot, fps: number): number {
  const textEnd = lastTextEnterEnd(shot, fps);
  if (textEnd !== undefined) return clampFrame(shot, textEnd);
  if (shot.move.preset !== 'static-hold') return clampFrame(shot, moveWindow(shot).endFrame - 1);
  return clampFrame(shot, Math.floor((shot.durationFrames - 1) / 2));
}
