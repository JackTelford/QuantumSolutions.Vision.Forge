/**
 * Frame and time conversions shared by every lane.
 *
 * All animation in this repository is a function of a frame number. These
 * helpers are the only place frames are turned into seconds or milliseconds,
 * so every lane rounds the same way. Runs in Node and in the browser.
 */

/** Seconds elapsed at the start of `frame` at `fps` frames per second. */
export function frameToSeconds(frame: number, fps: number): number {
  return frame / fps;
}

/** Milliseconds elapsed at the start of `frame`, as the Web Animations API expects for currentTime. */
export function frameToMilliseconds(frame: number, fps: number): number {
  return (frame * 1000) / fps;
}

/** Number of whole frames that cover `seconds` at `fps`, rounded to the nearest frame. */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}
