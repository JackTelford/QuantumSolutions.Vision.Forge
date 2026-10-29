/**
 * The five roots the harness server serves during a render, in the order
 * the page needs them: the repository's src/ (TypeScript stripped on the
 * fly, so browser code imports shared code by relative path), the installed
 * three package, the bundled OFL fonts, the per-shot page directory and the
 * data directory's downloaded assets. The URL prefixes are the protocol's
 * constants, so the page and the server cannot disagree.
 */
import { join, resolve } from 'node:path';
import { ensureDirectory } from '../fs/paths.ts';
import { assetsUrlPrefix, fontsUrlPrefix, pageUrlPrefix, sourceUrlPrefix } from '../shared/harness/protocol.ts';
import { threeVendorRootUnder } from './static-roots.ts';
import type { ServedRoot } from './static-roots.ts';

/** The repository root, resolved from this module's own location. */
export const repositoryRoot: string = resolve(import.meta.dirname, '..', '..');

/** The directory of the bundled fonts, relative to the repository root. */
export const fontsDirectory: string = join('skills', 'cinematic-studio', 'assets', 'fonts');

/** Where a render's roots come from. */
export interface RenderRootsOptions {
  readonly repoRoot: string;
  /** The directory holding the shot's index.html. */
  readonly pageDir: string;
  readonly dataDir: string;
}

/**
 * The roots of one render. The assets directory under the data directory is
 * created when missing, because a shot without assets still serves the
 * prefix and the server refuses a root whose directory does not exist.
 */
export function renderServedRoots(options: RenderRootsOptions): readonly ServedRoot[] {
  return [
    { urlPrefix: sourceUrlPrefix, directory: join(options.repoRoot, 'src') },
    threeVendorRootUnder(options.repoRoot),
    { urlPrefix: fontsUrlPrefix, directory: join(options.repoRoot, fontsDirectory) },
    { urlPrefix: pageUrlPrefix, directory: options.pageDir },
    { urlPrefix: assetsUrlPrefix, directory: ensureDirectory(join(options.dataDir, 'assets')) },
  ];
}
