/**
 * Where a rendered shot lives on disk: `<dataDir>/cache/<key>/` with the
 * frames, the manifest and the per-shot page directory inside. The key is
 * the shot hash (ADR 0006 decision 8), so a shot whose inputs changed lands
 * in a new folder and the old one is simply unused. Frame files are named
 * f000000.png, f000001.png and so on: six digits cover every shot length the
 * schema allows and give ffmpeg a printf pattern to read a run of frames.
 */
import { join } from 'node:path';
import { assertPathLength } from '../fs/paths.ts';

/** The folder under the data directory that holds every shot cache. */
export const cacheDirName = 'cache';

/** How many digits a frame number is padded to in a frame file name. */
export const frameNumberDigits = 6;

/** The largest frame number the file-name scheme can express. */
export const maxFrameNumber = 10 ** frameNumberDigits - 1;

/** The cache folder of a shot: `<dataDir>/cache/<key>`. */
export function shotCacheDir(dataDir: string, key: string): string {
  return join(dataDir, cacheDirName, key);
}

/** The frames folder inside a shot cache. */
export function framesDir(cacheDir: string): string {
  return join(cacheDir, 'frames');
}

/** The file name of a frame: `f` plus the frame number padded to six digits plus `.png`, for example f000012.png. */
export function frameFileName(frame: number): string {
  if (!Number.isInteger(frame) || frame < 0 || frame > maxFrameNumber) {
    throw new RangeError(`A frame number must be an integer from 0 to ${maxFrameNumber}; got ${String(frame)}.`);
  }
  return `f${String(frame).padStart(frameNumberDigits, '0')}.png`;
}

/** The absolute path of a frame's PNG inside a frames folder. */
export function framePath(framesDirectory: string, frame: number): string {
  return join(framesDirectory, frameFileName(frame));
}

/** The printf pattern ffmpeg and the assembly plan read the frames with, with forward slashes so it reads the same on every platform: `<framesDir>/f%06d.png`. */
export function framePattern(framesDirectory: string): string {
  return join(framesDirectory, `f%0${frameNumberDigits}d.png`).replace(/\\/g, '/');
}

/** The manifest's path inside a shot cache. */
export function manifestPath(cacheDir: string): string {
  return join(cacheDir, 'manifest.json');
}

/** The per-shot page directory the harness serves under /page/. */
export function pageDir(cacheDir: string): string {
  return join(cacheDir, 'page');
}

/** The deepest path a shot cache holds: a frame file, which is longer than the manifest and the page. */
export function deepestCachePath(cacheDir: string): string {
  return framePath(framesDir(cacheDir), 0);
}

/** Throws PathTooLongError on Windows when the shot cache's deepest path would exceed the path limit. */
export function assertCachePathLength(cacheDir: string): void {
  assertPathLength(deepestCachePath(cacheDir));
}
