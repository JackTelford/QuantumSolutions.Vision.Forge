/**
 * The one file that calls the real browser harness and html lane modules:
 * the Playwright session (src/harness/browser-session.ts), the page
 * builder (src/lanes/html/page.ts), the served roots, the machine
 * fingerprint and the lane code hash. Everything else in src/render/ goes
 * through the RenderSeams interface, so tests replace exactly these
 * functions and a signature change in a harness module is fixed here.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';
import { openBrowserRenderer } from '../harness/browser-session.ts';
import { buildFingerprint, readMachineFingerprint, threeVersion } from '../harness/fingerprint.ts';
import { HarnessServer } from '../harness/harness-server.ts';
import { renderServedRoots, repositoryRoot } from '../harness/served-roots.ts';
import type { BrowserRenderer } from '../harness/types.ts';
import { pageUrl, writeShotPage } from '../lanes/html/page.ts';
import { laneCodeHash } from '../lanes/lane-code-hash.ts';
import type { Lane } from '../shared/contracts/shot-spec.ts';
import type { ManifestFingerprint } from './manifest.ts';
import type { FingerprintOptions, HarnessHandle, OpenRendererOptions, RenderSeams, StartHarnessOptions } from './seams.ts';

/** Starts the harness server over the render roots (source, three, fonts, the page directory and the data directory's assets). */
export async function startHarness(options: StartHarnessOptions): Promise<HarnessHandle> {
  const server = new HarnessServer({ roots: renderServedRoots({ repoRoot: repositoryRoot, pageDir: options.pageDir, dataDir: options.dataDir }), log: options.log });
  await server.start(options.signal);
  return { url: server.url, stop: (): Promise<void> => server.stop() };
}

/** Opens the system browser as a renderer at the frame size under the renderer policy. */
export function openRealRenderer(options: OpenRendererOptions): Promise<BrowserRenderer> {
  return openBrowserRenderer({
    channel: options.browser.channel,
    executablePath: options.browser.path,
    version: options.browser.version,
    dataDir: options.dataDir,
    policy: options.policy,
    width: options.width,
    height: options.height,
    log: options.log,
  }, options.signal);
}

/** The manifest fingerprint: the renderer's browser part, the machine part (DPI, ClearType), Node, ffmpeg and, for the three lane, three. */
export async function manifestFingerprint(options: FingerprintOptions): Promise<ManifestFingerprint> {
  const machine = await readMachineFingerprint(options.runner, process.env, process.platform, options.signal);
  return buildFingerprint({
    browser: options.renderer.fingerprint,
    machine,
    node: process.version,
    ...(options.lane === 'three' ? { three: threeVersion() } : {}),
    ffmpeg: options.ffmpegVersion,
  });
}

/** The lane code hash of a browser lane; the blender lane has no renderer here yet (both commands refuse its shots before asking). */
export function browserLaneCodeHash(lane: Lane): Promise<string> {
  if (lane === 'blender') {
    return Promise.reject(new VisionForgeError({
      code: 'lane-unavailable',
      message: 'The blender lane has no code hash yet, so no key can be computed for its shots.',
      hint: 'The blender lane arrives with milestone M5; until then plan the shot on the html or three lane. See docs/handoff.md.',
    }));
  }
  return laneCodeHash(lane);
}

/** The real seams. */
export const realSeams: RenderSeams = {
  writeShotPage: (pageDir: string, width: number, height: number): void => { writeShotPage(pageDir, width, height); },
  pageUrl,
  startHarness,
  openRenderer: openRealRenderer,
  manifestFingerprint,
  laneCodeHash: browserLaneCodeHash,
};
