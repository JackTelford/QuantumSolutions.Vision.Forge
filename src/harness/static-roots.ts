/**
 * The allowlist of directories the harness server may serve, and the one
 * function that turns a URL path into a file path inside its root.
 *
 * A request is served only when its path starts with a root's URL prefix
 * and, after percent-decoding and normalization, still lies inside that
 * root's directory. Anything else is refused before any file is read.
 */
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';
import { ToolMissingError, VisionForgeError } from '../errors/vision-forge-error.ts';

/** A URL prefix mapped to a directory on disk. The prefix starts and ends with a slash. */
export interface ServedRoot {
  readonly urlPrefix: string;
  readonly directory: string;
}

/** The URL prefix under which the installed three package is served. */
export const threeVendorPrefix = '/vendor/three/';

const repositoryRoot: string = resolve(import.meta.dirname, '..', '..');

const servedRootHint = 'Pass each root as { urlPrefix: "/prefix/", directory: "<absolute path of an existing directory>" }.';

function servedRootError(message: string): VisionForgeError {
  return new VisionForgeError({ code: 'harness-server', message, hint: servedRootHint });
}

/**
 * Throws, naming the offending value, unless the root can be served: the
 * URL prefix starts and ends with "/" and the directory is an absolute path
 * to an existing directory. The label names the root in messages, for
 * example `roots[0]`.
 */
export function assertServedRoot(root: ServedRoot, label: string): void {
  if (!root.urlPrefix.startsWith('/') || !root.urlPrefix.endsWith('/')) {
    throw servedRootError(`${label}.urlPrefix "${root.urlPrefix}" must start and end with "/".`);
  }
  if (!isAbsolute(root.directory)) {
    throw servedRootError(`${label}.directory "${root.directory}" is not an absolute path.`);
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(root.directory).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw servedRootError(`${label}.directory "${root.directory}" is not an existing directory.`);
  }
}

/**
 * The root whose URL prefix the path starts with. When prefixes nest (for
 * example `/` and `/vendor/three/`), the longest one wins, whatever the
 * order of the list.
 */
export function findRoot(roots: readonly ServedRoot[], urlPath: string): ServedRoot | undefined {
  let best: ServedRoot | undefined;
  for (const root of roots) {
    if (!urlPath.startsWith(root.urlPrefix)) continue;
    if (best === undefined || root.urlPrefix.length > best.urlPrefix.length) best = root;
  }
  return best;
}

/**
 * The absolute file path a URL path names inside its root, or undefined when
 * the path does not start with the root's prefix, cannot be percent-decoded,
 * contains a null byte, or escapes the root's directory after decoding and
 * normalization. The bare prefix resolves to the directory itself; the
 * server refuses directories separately.
 */
export function resolveWithinRoot(root: ServedRoot, urlPath: string): string | undefined {
  if (!urlPath.startsWith(root.urlPrefix)) return undefined;
  let relativePart: string;
  try {
    relativePart = decodeURIComponent(urlPath.slice(root.urlPrefix.length));
  } catch {
    return undefined;
  }
  if (relativePart.includes('\0')) return undefined;
  const base = resolve(root.directory);
  const target = normalize(resolve(base, relativePart));
  if (target !== base && !target.startsWith(base + sep)) return undefined;
  return target;
}

/** The three vendor root of a repository: `/vendor/three/` mapped to `<repoRoot>/node_modules/three`. */
export function threeVendorRootUnder(repoRoot: string): ServedRoot {
  const directory = resolve(repoRoot, 'node_modules', 'three');
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new ToolMissingError('The three package (node_modules/three)', `Run "npm ci" in ${repoRoot} to install the pinned dependencies.`);
  }
  return { urlPrefix: threeVendorPrefix, directory };
}

/** The three vendor root of this repository, resolved from this module's own location. */
export function threeVendorRoot(): ServedRoot {
  return threeVendorRootUnder(repositoryRoot);
}
