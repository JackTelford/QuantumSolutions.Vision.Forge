/**
 * Where a contact sheet's frames come from: a JSON file listing
 * `[{ "path": "...", "label": "..." }]` (relative paths resolve against the
 * file's directory) or a directory, whose PNG files are taken in name order
 * with the file name (without extension) as the label.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { DataFileError } from '../errors/vision-forge-error.ts';
import { readJsonFile } from '../fs/atomic-json.ts';
import { isJsonObject } from '../schema/schema-registry.ts';
import type { SheetFrame } from './contact-sheet.ts';

const listHint = 'The file is a JSON array of { "path": "<png>", "label": "<caption>" }; or pass a directory of PNG files.';

/** Turns the parsed JSON of a frame list into SheetFrame records; throws DataFileError naming the first bad entry. */
export function parseFrameList(value: unknown, path: string): SheetFrame[] {
  if (!Array.isArray(value)) throw new DataFileError(path, 'the frame list is not a JSON array', listHint);
  const frames = value.map((entry: unknown, index: number): SheetFrame => {
    if (!isJsonObject(entry)) throw new DataFileError(path, `entry ${index} is not an object`, listHint);
    const framePath = entry['path'];
    const label = entry['label'];
    if (typeof framePath !== 'string' || framePath.length === 0) throw new DataFileError(path, `entry ${index} has no "path"`, listHint);
    if (typeof label !== 'string') throw new DataFileError(path, `entry ${index} has no "label"`, listHint);
    return { path: resolve(dirname(path), framePath), label };
  });
  if (frames.length === 0) throw new DataFileError(path, 'it lists no frames', listHint);
  return frames;
}

/** The PNG files of a directory in name order, labelled by file name without the extension. */
export function framesInDirectory(dir: string): SheetFrame[] {
  const names = readdirSync(dir).filter((name) => extname(name).toLowerCase() === '.png').sort();
  if (names.length === 0) throw new DataFileError(dir, 'the directory holds no PNG files', listHint);
  return names.map((name) => ({ path: join(dir, name), label: name.slice(0, -extname(name).length) }));
}

/** Reads the frames from a JSON list file or a directory. */
export function readFrameList(source: string): SheetFrame[] {
  let isDirectory: boolean;
  try {
    isDirectory = statSync(source).isDirectory();
  } catch {
    throw new DataFileError(source, 'the path does not exist', listHint);
  }
  return isDirectory ? framesInDirectory(source) : parseFrameList(readJsonFile(source), source);
}
