/**
 * Renders one frame of a page spec through the real harness, the way the
 * still command does it but without a job, a cache or a manifest: the page
 * is written, the harness server started over the render roots, the
 * browser opened under a renderer policy, the frame captured, everything
 * closed. The calibration probe, the lookdev probe and the parity test
 * share it, so the three renders go through exactly the production path
 * and the browser's own words reach the caller when the page fails.
 */
import { join } from 'node:path';
import type { Logger } from '../cli/logger.ts';
import { ensureDirectory } from '../fs/paths.ts';
import { openBrowserRenderer } from '../harness/browser-session.ts';
import type { BrowserRenderer, RendererPolicy } from '../harness/types.ts';
import type { RenderProfile } from '../shared/contracts/shot-spec.ts';
import type { Browser } from '../shared/contracts/tools.ts';
import type { ShotPageSpec } from '../shared/harness/protocol.ts';
import { pageUrl, writeShotPage } from '../lanes/html/page.ts';
import { startHarness } from '../render/harness-factory.ts';
import type { HarnessHandle } from '../render/seams.ts';

/** The browser to render with: the three fields of a tools.json entry the launch needs. */
export type StillBrowser = Pick<Browser, 'channel' | 'path' | 'version'>;

/** What renderStill needs. */
export interface StillRenderOptions {
  /** The page spec, already built (src/render/shot-page-spec.ts) with the lane, scene and environment the caller wants. */
  readonly spec: ShotPageSpec;
  /** The frame written to outPng. */
  readonly frame: number;
  /** Frames rendered after `frame` into the work folder only, to time a frame; 0 for none. Each must be a frame of the shot. */
  readonly timingFrames: number;
  readonly outPng: string;
  /** The data directory: its assets are served under /assets/ and the browser profile lives under it. */
  readonly dataDir: string;
  /** Scratch folder for the page and the timing frames; created when missing, the caller removes it. */
  readonly workDir: string;
  readonly browser: StillBrowser;
  readonly policy: RendererPolicy;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

/** What renderStill reports beside the PNG. */
export interface StillRenderResult {
  readonly png: string;
  /** UNMASKED_RENDERER_WEBGL as the harness read it at launch. */
  readonly webglRenderer: string;
  readonly profile: RenderProfile;
  /** From opening the page to the first captured frame: the page load, the fonts, the environment map and frame 0. */
  readonly initMs: number;
  /** The mean time between consecutive captured frames after the first (seek, render, screenshot, PNG write); null without timing frames. */
  readonly msPerFrame: number | null;
  /** The browser launch, from the call to a renderer ready for a page. */
  readonly launchMs: number;
}

const millisecondsSince = (started: bigint): number => Number(process.hrtime.bigint() - started) / 1_000_000;

/** Renders the frame and returns where it went with its timings. */
export async function renderStill(options: StillRenderOptions): Promise<StillRenderResult> {
  const { spec } = options;
  const pageDir = ensureDirectory(join(options.workDir, 'page'));
  const timingDir = ensureDirectory(join(options.workDir, 'timing'));
  writeShotPage(pageDir, spec.width, spec.height);
  let harness: HarnessHandle | undefined;
  let renderer: BrowserRenderer | undefined;
  try {
    harness = await startHarness({ pageDir, dataDir: options.dataDir, log: options.log, signal: options.signal });
    const launchStarted = process.hrtime.bigint();
    renderer = await openBrowserRenderer({
      channel: options.browser.channel,
      executablePath: options.browser.path,
      version: options.browser.version,
      dataDir: options.dataDir,
      policy: options.policy,
      width: spec.width,
      height: spec.height,
      log: options.log,
    }, options.signal);
    const launchMs = millisecondsSince(launchStarted);
    const frames = [options.frame, ...Array.from({ length: options.timingFrames }, (_, index) => options.frame + 1 + index)];
    const landed: bigint[] = [];
    const captureStarted = process.hrtime.bigint();
    await renderer.capture({
      pageUrl: pageUrl(harness.url),
      spec,
      frames,
      framePath: (frame): string => (frame === options.frame ? options.outPng : join(timingDir, `f${String(frame).padStart(6, '0')}.png`)),
    }, options.signal, () => { landed.push(process.hrtime.bigint()); });
    const first = landed[0] ?? captureStarted;
    const last = landed[landed.length - 1] ?? first;
    const msPerFrame = landed.length > 1 ? Number(last - first) / 1_000_000 / (landed.length - 1) : null;
    return { png: options.outPng, webglRenderer: renderer.fingerprint.webglRenderer, profile: renderer.profile, initMs: Number(first - captureStarted) / 1_000_000, msPerFrame, launchMs };
  } finally {
    if (renderer !== undefined) await renderer.close();
    if (harness !== undefined) await harness.stop();
  }
}
