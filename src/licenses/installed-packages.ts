/**
 * Walks node_modules the way npm lays it out: top-level packages, scoped
 * packages under @scope/, and nested node_modules inside packages. A link
 * to a directory (npm workspaces, file: dependencies, npm link) is followed;
 * hidden entries (.bin, .package-lock.json, .cache) are skipped. Whether a
 * package is a production dependency of the root comes from
 * package-lock.json, whose "packages" entries are keyed by the same
 * relative path.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { DataFileError } from '../errors/vision-forge-error.ts';
import { readJsonFile } from '../fs/atomic-json.ts';
import { declaredLicense, isRecord, repositoryUrl } from './package-json.ts';
import type { JsonRecord } from './package-json.ts';

/** One package directory found under node_modules. */
export interface InstalledPackage {
  readonly name: string;
  readonly version: string;
  /** Directory relative to the project root with forward slashes, for example node_modules/@types/node. */
  readonly path: string;
  /** The declared license expression; undefined when package.json declares none. */
  readonly license: string | undefined;
  readonly repository: string | undefined;
  /** True when package-lock.json marks the package as reachable only through devDependencies. */
  readonly dev: boolean;
}

/** Orders packages by their relative path, which is unique. */
export function comparePackagePaths(a: InstalledPackage, b: InstalledPackage): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function readLockPackages(projectRoot: string): JsonRecord {
  const lockPath = join(projectRoot, 'package-lock.json');
  const lock = readJsonFile(lockPath);
  const packages = isRecord(lock) ? lock['packages'] : undefined;
  if (!isRecord(packages)) throw new DataFileError(lockPath, 'it has no "packages" map (lockfileVersion 2 or 3 is required)', 'Run npm install to regenerate the lock file.');
  return packages;
}

/**
 * "dev": reachable only from devDependencies. "optional" and "devOptional"
 * packages are still installed for production (devOptional = dev AND an
 * optional dependency of a production package), so they stay production.
 */
function isDevOnly(lockPackages: JsonRecord, path: string): boolean {
  const entry = lockPackages[path];
  if (!isRecord(entry)) return false;
  return entry['dev'] === true;
}

/** True for a directory or a link (symlink or junction) that resolves to one; a dangling link is not. */
function isDirectoryEntry(dir: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  return entry.isSymbolicLink() && statSync(join(dir, entry.name), { throwIfNoEntry: false })?.isDirectory() === true;
}

function visibleDirectories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && isDirectoryEntry(dir, entry))
    .map((entry) => entry.name)
    .sort();
}

/** Reads every package under the project's node_modules, sorted by path. */
export function readInstalledPackages(projectRoot: string): InstalledPackage[] {
  const modulesDir = join(projectRoot, 'node_modules');
  if (!existsSync(modulesDir)) throw new DataFileError(modulesDir, 'the directory does not exist', 'Run npm ci first.');
  const lockPackages = readLockPackages(projectRoot);
  const packages: InstalledPackage[] = [];
  walkModules(modulesDir, 'node_modules', lockPackages, packages);
  return packages.sort(comparePackagePaths);
}

function walkModules(dir: string, relative: string, lock: JsonRecord, out: InstalledPackage[]): void {
  for (const name of visibleDirectories(dir)) {
    if (name.startsWith('@')) {
      for (const inner of visibleDirectories(join(dir, name))) visitPackage(join(dir, name, inner), `${relative}/${name}/${inner}`, lock, out);
    } else {
      visitPackage(join(dir, name), `${relative}/${name}`, lock, out);
    }
  }
}

function visitPackage(dir: string, relative: string, lock: JsonRecord, out: InstalledPackage[]): void {
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) return;
  const manifest = readJsonFile(manifestPath);
  if (!isRecord(manifest)) throw new DataFileError(manifestPath, 'it is not a JSON object', 'Reinstall the package with npm ci.');
  const name = manifest['name'];
  const version = manifest['version'];
  out.push({
    name: typeof name === 'string' && name.length > 0 ? name : relative.slice(relative.lastIndexOf('node_modules/') + 'node_modules/'.length),
    version: typeof version === 'string' && version.length > 0 ? version : 'unknown',
    path: relative,
    license: declaredLicense(manifest),
    repository: repositoryUrl(manifest),
    dev: isDevOnly(lock, relative),
  });
  const nested = join(dir, 'node_modules');
  if (existsSync(nested)) walkModules(nested, `${relative}/node_modules`, lock, out);
}
