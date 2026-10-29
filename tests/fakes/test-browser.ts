/**
 * Which installed browser the integration tests drive. Production prefers
 * Edge (src/tools/browsers.ts), but on the Linux CI runner Edge times out
 * at launch while Chrome works (docs/evidence/m0/ci-actions.md), so the
 * tests prefer Chrome on Linux and honour VF_TEST_BROWSER (msedge or
 * chrome) everywhere. Not a test file.
 */
import { readToolsManifest, writeToolsManifest } from '../../src/tools/tools-manifest.ts';
import { findBrowsers } from '../../src/tools/browsers.ts';
import type { FoundBrowser } from '../../src/tools/browsers.ts';
import type { Channel } from '../../src/shared/contracts/tools.ts';

/** The environment variable that names the channel the tests should drive. */
export const testBrowserVariable = 'VF_TEST_BROWSER';

/** The channel the tests prefer: VF_TEST_BROWSER when set, chrome on Linux, Edge elsewhere. */
export function preferredTestChannel(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): Channel {
  const named = env[testBrowserVariable];
  if (named === 'msedge' || named === 'chrome') return named;
  return platform === 'linux' ? 'chrome' : 'msedge';
}

/** The installed browser the tests drive: the preferred channel when it is installed, else the first found; undefined when none is installed. */
export function testBrowser(): FoundBrowser | undefined {
  const found = findBrowsers().found;
  return found.find((browser) => browser.channel === preferredTestChannel()) ?? found[0];
}

/** Rewrites tools.json under a data directory so the preferred channel comes first, which is the browser still and render pick. */
export function preferTestBrowserInManifest(dataDir: string): void {
  const manifest = readToolsManifest(dataDir);
  const channel = preferredTestChannel();
  const preferred = manifest.browsers.filter((browser) => browser.channel === channel);
  const others = manifest.browsers.filter((browser) => browser.channel !== channel);
  writeToolsManifest(dataDir, { ...manifest, browsers: [...preferred, ...others] });
}
