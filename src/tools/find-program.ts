/**
 * Finds external programs the way doctor documents it: an environment
 * variable override first, then PATH (honoring PATHEXT on Windows), then a
 * list of well-known install folders. Only real executables are returned;
 * on Windows a `.cmd` or `.bat` shim is never accepted, because programs are
 * spawned without a shell.
 */
import { existsSync, statSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';

/** Where a program was found. */
export interface FoundProgram {
  readonly path: string;
  /** "env", "path" or "known-folder". */
  readonly foundBy: 'env' | 'path' | 'known-folder';
}

const shellExtensions: readonly string[] = ['.cmd', '.bat', '.ps1'];

/** True when the path names an existing file that can be spawned without a shell. */
export function isRunnableFile(path: string): boolean {
  if (!existsSync(path)) return false;
  if (!statSync(path).isFile()) return false;
  return !shellExtensions.includes(extname(path).toLowerCase());
}

/** The executable extensions to try on this platform, in PATHEXT order on Windows. */
export function executableExtensions(platform: NodeJS.Platform = process.platform, env: Readonly<Record<string, string | undefined>> = process.env): readonly string[] {
  if (platform !== 'win32') return [''];
  const raw = env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM';
  const list = raw.split(';').map((extension) => extension.toLowerCase()).filter((extension) => extension.length > 0);
  return list.includes('.exe') ? list : ['.exe', ...list];
}

/** Looks a program name up on PATH. Returns undefined when absent or when only a shell shim exists. */
export function findOnPath(name: string, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const pathValue = env['PATH'] ?? env['Path'] ?? '';
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const extension of executableExtensions(platform, env)) {
      const candidate = join(dir, `${name}${extension}`);
      if (isRunnableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Finds a program: the override variable when set (it must point at a runnable
 * file), then PATH, then the known folders in order.
 */
export function findProgram(name: string, overrideVariable: string, knownPaths: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): FoundProgram | undefined {
  const override = env[overrideVariable];
  if (override !== undefined && override.length > 0) {
    return isRunnableFile(override) ? { path: override, foundBy: 'env' } : undefined;
  }
  const onPath = findOnPath(name, env, platform);
  if (onPath !== undefined) return { path: onPath, foundBy: 'path' };
  for (const candidate of knownPaths) {
    if (isRunnableFile(candidate)) return { path: candidate, foundBy: 'known-folder' };
  }
  return undefined;
}
