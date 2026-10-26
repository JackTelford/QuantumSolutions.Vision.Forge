/**
 * JSON files that are never half-written: write to a temporary file in the
 * same directory, flush, then rename over the target. Reads cap the size and
 * report the file path in every error.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DataFileError } from '../errors/vision-forge-error.ts';

/** Largest JSON file this repository reads by default (16 MiB). */
export const defaultMaxJsonBytes = 16 * 1024 * 1024;

/** Writes a value as pretty-printed JSON, atomically. */
export function writeJsonAtomic(path: string, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.tmp`);
  const handle = openSync(temp, 'w');
  try {
    writeSync(handle, text, null, 'utf8');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    renameSync(temp, path);
  } catch (error: unknown) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Reads and parses a JSON file. The caller validates the shape. */
export function readJsonFile(path: string, maxBytes = defaultMaxJsonBytes): unknown {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new DataFileError(path, 'the file does not exist', 'Create it with the command that owns it, or check the path.');
  }
  if (size > maxBytes) throw new DataFileError(path, `it is ${size} bytes, over the ${maxBytes} byte limit`, 'This file should be small; it may be corrupt.');
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new DataFileError(path, `it is not valid JSON (${error instanceof Error ? error.message : String(error)})`, 'Delete or repair the file and run the command again.');
  }
}
