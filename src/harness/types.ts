/**
 * What the render module asks of the browser harness, as interfaces, so
 * that the render orchestration can be tested with a fake renderer that
 * writes frames without a browser. browser-session.ts implements them with
 * Playwright on the system browser (ADR 0006).
 */
import { browserLaunchFlags } from '../plan/shot-key.ts';
import type { RenderProfile, Renderer } from '../shared/contracts/shot-spec.ts';
import type { Channel } from '../shared/contracts/tools.ts';
import type { InitReport, ShotPageSpec } from '../shared/harness/protocol.ts';

/** What the caller expects of the renderer (ADR 0006 decision 4); `any` accepts whatever the browser offers. */
export type RendererPolicy = Renderer | 'any';

/** The renderer policies as a list, for argument parsing. */
export const rendererPolicies: readonly RendererPolicy[] = ['hardware', 'software', 'any'];

/** The engine the browser lanes record in a render profile. */
export const browserEngine = 'chromium';

/**
 * The ANGLE backend Chromium is launched with for a renderer on a platform:
 * the native API for hardware (Direct3D 11 on Windows, Metal on macOS, GL
 * on Linux), SwiftShader for software everywhere. Probe P4 measured the
 * Windows pair; the others are Chromium's documented backends.
 */
export function angleBackend(renderer: Renderer, platform: NodeJS.Platform = process.platform): string {
  if (renderer === 'software') return 'swiftshader-webgl';
  if (platform === 'win32') return 'd3d11';
  if (platform === 'darwin') return 'metal';
  return 'gl';
}

/** The launch flags for a renderer: exactly the shot key's flag set plus the `--use-angle` choice, in that order. */
export function browserArgs(renderer: Renderer, platform: NodeJS.Platform = process.platform): readonly string[] {
  return [...browserLaunchFlags, `--use-angle=${angleBackend(renderer, platform)}`];
}

/** The render profile of the browser lanes for a renderer. */
export function browserRenderProfile(renderer: Renderer, platform: NodeJS.Platform = process.platform): RenderProfile {
  return { engine: browserEngine, backend: angleBackend(renderer, platform), renderer };
}

/** The browser part of a render manifest's fingerprint (ADR 0006 decision 5). */
export interface BrowserFingerprint {
  readonly channel: Channel;
  /** Full four-part version, as tools.json records it. */
  readonly version: string;
  /** The launch flags, in order. */
  readonly args: readonly string[];
  /** UNMASKED_RENDERER_WEBGL as the capability page read it at startup. */
  readonly webglRenderer: string;
}

/** One frame the renderer wrote. */
export interface CapturedFrame {
  readonly frame: number;
  /** Absolute path of the PNG. */
  readonly path: string;
  /** How long the screenshot took, for the timing evidence. */
  readonly screenshotMs: number;
}

/** What to render: the page, its spec, which frames, and where each frame's PNG goes. */
export interface CaptureRequest {
  /** The served page URL, for example http://127.0.0.1:5123/page/index.html. */
  readonly pageUrl: string;
  readonly spec: ShotPageSpec;
  /** The frames to capture, in the order to capture them. */
  readonly frames: readonly number[];
  /** The absolute PNG path for a frame. */
  readonly framePath: (frame: number) => string;
  /** Called once with the page's init report after it passed the harness's checks, before the first frame. */
  readonly onInit?: (report: InitReport) => void;
}

/** A browser that renders shot pages: one launch, many captures, one close. */
export interface BrowserRenderer {
  /** How it rendered: engine, backend and whether the pixels come from hardware or software. */
  readonly profile: RenderProfile;
  readonly fingerprint: BrowserFingerprint;
  /**
   * Opens the page, initialises it with the spec, seeks and screenshots
   * every requested frame in order, calling onFrame as each lands. Throws a
   * VisionForgeError naming the page's own error when init or a seek fails.
   */
  capture(request: CaptureRequest, signal: AbortSignal, onFrame?: (frame: CapturedFrame) => void): Promise<readonly CapturedFrame[]>;
  /** Closes the browser and removes its profile directory; safe to call twice. */
  close(): Promise<void>;
}
