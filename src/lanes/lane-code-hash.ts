/**
 * The lane code hash of ADR 0006 decision 8: one content hash over the
 * files that shape a lane's pixels, so that a change to rendering code
 * changes every shot key of that lane while a change in another lane's
 * folder does not. The browser lanes hash src/shared/ (the camera, motion,
 * typography and protocol code that runs in the page), the runtime under
 * src/browser/runtime/, the lane's own folder, the Node-side page document
 * (src/lanes/html/page.ts fixes the background, the root CSS and the
 * @font-face rules) and the bundled font files the text is rasterised
 * from; the blender lane hashes src/shared/ and the one Python applier.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fontsDirectory, repositoryRoot } from '../harness/served-roots.ts';
import type { BrowserLane } from '../shared/harness/protocol.ts';
import { contentHash, sha256Hex } from '../shared/sha256.ts';

/** The lanes a code hash exists for. */
export type HashedLane = BrowserLane | 'blender';

/** One hashed file: its path relative to the repository root with forward slashes, and the SHA-256 of its bytes. */
export interface HashedFile {
  readonly path: string;
  readonly sha256: string;
}

/** A directory whose files with one extension enter a lane's hash; the directory is relative to the repository root. */
export interface HashedDirectory {
  readonly directory: string;
  readonly extension: string;
}

/** The directories a lane hashes, relative to the repository root. */
export function laneSourceDirectories(lane: HashedLane): readonly HashedDirectory[] {
  const shared: HashedDirectory = { directory: join('src', 'shared'), extension: '.ts' };
  if (lane === 'blender') return [shared];
  return [
    shared,
    { directory: join('src', 'browser', 'runtime'), extension: '.ts' },
    { directory: join('src', 'browser', lane), extension: '.ts' },
    { directory: fontsDirectory, extension: '.ttf' },
  ];
}

/** The single files that enter a lane's hash besides the directories: the page document for the browser lanes, the applier for blender. */
export function laneSourceFiles(lane: HashedLane): readonly string[] {
  return lane === 'blender' ? [join('blender', 'apply_scene.py')] : [join('src', 'lanes', 'html', 'page.ts')];
}

/** Every file with the extension under a directory, recursively, sorted by name at each level; nothing when the directory is absent. */
function collectFiles(directory: string, extension: string, into: string[]): void {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return;
  // readdir order is file-system dependent; sorting here keeps the walk the same on every machine.
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) collectFiles(path, extension, into);
    else if (name.endsWith(extension)) into.push(path);
  }
}

/** The files a lane hashes under a repository root, as repository-relative paths with forward slashes, sorted. */
export function laneSourcePaths(lane: HashedLane, repoRoot: string): readonly string[] {
  const absolute: string[] = [];
  for (const { directory, extension } of laneSourceDirectories(lane)) collectFiles(join(repoRoot, directory), extension, absolute);
  for (const file of laneSourceFiles(lane)) {
    const path = join(repoRoot, file);
    // The applier arrives with M5; a lane hash before that still has to exist.
    if (existsSync(path)) absolute.push(path);
  }
  return absolute.map((path) => relative(repoRoot, path).split(sep).join('/')).sort();
}

/** Hashes every file of the lane under the root, without the cache. */
export async function computeLaneCodeHash(lane: HashedLane, repoRoot: string): Promise<string> {
  const files: HashedFile[] = [];
  for (const path of laneSourcePaths(lane, repoRoot)) {
    files.push({ path, sha256: await sha256Hex(readFileSync(join(repoRoot, ...path.split('/')))) });
  }
  return contentHash(files);
}

const cache = new Map<HashedLane, Promise<string>>();

/**
 * The lane code hash as 64 lowercase hex characters. The repository's own
 * sources do not change while a command runs, so the hash of the default
 * root is computed once per lane per process; another root (a test tree)
 * is walked every time.
 */
export function laneCodeHash(lane: HashedLane, repoRoot: string = repositoryRoot): Promise<string> {
  if (repoRoot !== repositoryRoot) return computeLaneCodeHash(lane, repoRoot);
  let pending = cache.get(lane);
  if (pending === undefined) {
    pending = computeLaneCodeHash(lane, repoRoot);
    cache.set(lane, pending);
  }
  return pending;
}
