/**
 * What the render orchestration needs from the browser harness and the
 * html lane, as an interface. harness-factory.ts implements it with the
 * real modules (Playwright on the system browser, the page builder, the
 * machine fingerprint, the lane code hash); tests implement it with fakes
 * that write PNGs and never open a browser. The commands load the real
 * implementation only after their argument and job checks, so a usage
 * error never launches anything.
 */
import type { Logger } from '../cli/logger.ts';
import type { BrowserRenderer, RendererPolicy } from '../harness/types.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { Lane } from '../shared/contracts/shot-spec.ts';
import type { Browser } from '../shared/contracts/tools.ts';
import type { ManifestFingerprint } from './manifest.ts';

/** The page every browser lane renders in: written once per size, loaded from the harness. */
export interface PageSeam {
  /** Writes index.html (and nothing else) into the page directory for a frame size. */
  writeShotPage(pageDir: string, width: number, height: number): void;
  /** The page's URL on a running harness, for example http://127.0.0.1:5123/page/index.html. */
  pageUrl(harnessUrl: string): string;
}

/** A running harness server. */
export interface HarnessHandle {
  /** The base URL, http://127.0.0.1:<port>. */
  readonly url: string;
  stop(): Promise<void>;
}

/** What starting the harness needs. */
export interface StartHarnessOptions {
  /** The directory the page is served from under /page/. */
  readonly pageDir: string;
  /** The data directory, whose assets/ folder is served under /assets/. */
  readonly dataDir: string;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

/** What opening a browser renderer needs. */
export interface OpenRendererOptions {
  /** The browser doctor found, as tools.json records it. */
  readonly browser: Browser;
  readonly policy: RendererPolicy;
  /** The viewport, which is the frame size. */
  readonly width: number;
  readonly height: number;
  /** The browser profile lives under the data directory. */
  readonly dataDir: string;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

/** What the manifest fingerprint is built from. */
export interface FingerprintOptions {
  readonly renderer: BrowserRenderer;
  readonly lane: Lane;
  /** The ffmpeg version tools.json records. */
  readonly ffmpegVersion: string;
  readonly runner: ProcessRunner;
  readonly signal: AbortSignal;
}

/** Everything the commands and renderShot call through. */
export interface RenderSeams extends PageSeam {
  startHarness(options: StartHarnessOptions): Promise<HarnessHandle>;
  openRenderer(options: OpenRendererOptions): Promise<BrowserRenderer>;
  /** The manifest fingerprint of a renderer: browser, machine, Node, ffmpeg and (for the three lane) three versions. */
  manifestFingerprint(options: FingerprintOptions): Promise<ManifestFingerprint>;
  /** Content hash of the lane's sources, the part of the shot key that changes when rendering code changes. */
  laneCodeHash(lane: Lane): Promise<string>;
}

/** Loads the real implementation on demand, so a command that fails its checks never imports Playwright. */
export async function loadRealSeams(): Promise<RenderSeams> {
  const factory = await import('./harness-factory.ts');
  return factory.realSeams;
}
