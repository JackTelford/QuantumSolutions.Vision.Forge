/**
 * Where things live on disk, and the guards around Windows path limits.
 *
 * The data directory holds caches, the tool manifest, browser profiles and
 * optional components. It is never read from CLAUDE_PLUGIN_* environment
 * variables: those are inline substitutions in skill text, not environment
 * variables, so every command receives --data-dir explicitly or falls back to
 * the per-OS default below.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { PathTooLongError } from '../errors/vision-forge-error.ts';

/** Environment variable that overrides the default data directory. */
export const dataDirEnvironmentVariable = 'VISION_FORGE_DATA';

/** The default data directory for a platform, given its environment and home directory. */
export function defaultDataDir(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>, home: string): string {
  const override = env[dataDirEnvironmentVariable];
  if (override !== undefined && override.length > 0) return resolve(override);
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA'];
    return join(local !== undefined && local.length > 0 ? local : join(home, 'AppData', 'Local'), 'VisionForge');
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'VisionForge');
  const xdg = env['XDG_DATA_HOME'];
  return join(xdg !== undefined && xdg.length > 0 ? xdg : join(home, '.local', 'share'), 'vision-forge');
}

/** Resolves the data directory from an explicit argument or the per-OS default, creating it. */
export function resolveDataDir(explicit: string | undefined): string {
  const dir = explicit !== undefined && explicit.length > 0 ? resolve(explicit) : defaultDataDir(process.platform, process.env, homedir());
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolves the output directory from an explicit argument or `out` under the working directory, creating it. */
export function resolveOutDir(explicit: string | undefined, cwd: string): string {
  const dir = explicit !== undefined && explicit.length > 0 ? resolve(cwd, explicit) : join(cwd, 'out');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The longest path this repository allows itself to create on Windows without long-path support. */
export const windowsPathLimit = 240;

/** Throws PathTooLongError on Windows when a path (plus the room a frame name needs) exceeds the limit. */
export function assertPathLength(path: string, reserve = 0, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') return;
  if (path.length + reserve > windowsPathLimit) throw new PathTooLongError(path, windowsPathLimit - reserve);
}

/** Creates a directory tree and returns its path. */
export function ensureDirectory(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/**
 * Removes a directory tree, retrying with a growing delay. Browser profiles
 * keep lock files open for a moment after the browser exits, which makes a
 * single rmSync fail with EBUSY or EPERM on Windows.
 */
export async function removeDirectoryWithRetry(path: string, attempts = 8): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error: unknown) {
      lastError = error;
      await new Promise<void>((done) => setTimeout(done, 100 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Could not remove ${path}.`);
}
