/**
 * What a browser's WebGL context reports, read by launching the browser
 * headless through Playwright on a throw-away profile under the data
 * directory. The capability page is the one probe P4 used. Failures never
 * throw: the caller gets null with the reason and records it as a problem.
 */
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { BrowserContext } from 'playwright-core';
import type { Logger } from '../cli/logger.ts';
import { ensureDirectory, removeDirectoryWithRetry } from '../fs/paths.ts';
import type { Browser } from '../shared/contracts/tools.ts';

/** The WebGL report doctor records per browser (the non-null shape of Browser.webgl). */
export type WebglReport = NonNullable<Browser['webgl']>;

/** The browser to check: its Playwright channel and the executable doctor found. */
export interface BrowserToCheck {
  readonly channel: Browser['channel'];
  readonly path: string;
}

/** The outcome of a check: the report, or null with the reason it could not be read (one line, without the channel). */
export interface CapabilityCheck {
  readonly report: WebglReport | null;
  readonly reason?: string;
}

/** How long a launch may take; a browser that has not started by then is given up on. */
export const browserLaunchTimeoutMs = 30_000;

/** Launch arguments added on top of Playwright's defaults, the same as every render (ADR 0006). */
export const capabilityLaunchArgs: readonly string[] = ['--force-device-scale-factor=1'];

/** HTML of a page that creates a WebGL2 (or WebGL) context, draws one frame, reads a pixel back to prove the draw worked and exposes `window.capsJson`. */
export const webglCapabilityPage: string = `<!doctype html><html><head><meta charset="utf-8"><title>webgl caps</title></head>
<body style="margin:0;background:#202020">
<canvas id="c" width="640" height="360"></canvas>
<script>
(function () {
  const out = { ok: false, error: '', webgl2: false, renderer: '', vendor: '', extColorBufferFloat: false, userAgent: navigator.userAgent };
  try {
    const canvas = document.getElementById('c');
    let gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    out.webgl2 = gl !== null;
    if (gl === null) gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (gl === null) throw new Error('no WebGL context');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    out.vendor = info ? String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR));
    out.extColorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null;
    gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.finish();
    const px = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.ok = px[2] > 100;
    if (!out.ok) out.error = 'the cleared pixel read back as rgba(' + Array.from(px).join(', ') + ')';
  } catch (e) { out.error = String(e && e.message ? e.message : e); }
  window.capsJson = JSON.stringify(out);
})();
</script></body></html>`;

/** What the capability page writes into `window.capsJson`. */
interface CapabilityPageResult {
  readonly ok: boolean;
  readonly error: string;
  readonly webgl2: boolean;
  readonly renderer: string;
  readonly vendor: string;
  readonly extColorBufferFloat: boolean;
  readonly userAgent: string;
}

/** True when a renderer string names real hardware rather than a software rasterizer. */
export function isHardwareRenderer(renderer: string): boolean {
  return /NVIDIA|AMD|Radeon|Intel|Apple|Qualcomm/i.test(renderer) && !/SwiftShader|SwANGLE|WARP|Basic Render|llvmpipe/i.test(renderer);
}

/** The profile directory doctor uses for a channel's capability check. */
export function capabilityProfileDir(dataDir: string, channel: Browser['channel']): string {
  return join(dataDir, 'profiles', `doctor-${channel}`);
}

/** The page's error text, or a default when it reported none. */
function pageError(result: Partial<CapabilityPageResult>, fallback: string): string {
  return typeof result.error === 'string' && result.error.length > 0 ? result.error : fallback;
}

/**
 * Turns the page's JSON into the report doctor records, or a reason when the
 * page could not create a context or could not draw with it (a context that
 * exists but renders nothing, for example after a GPU-process crash, is not
 * usable for the three lane).
 */
export function parseCapabilityJson(json: string): { readonly report?: WebglReport; readonly reason?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { reason: 'the capability page returned no JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { reason: 'the capability page returned no object' };
  const result = parsed as Partial<CapabilityPageResult>;
  if (typeof result.ok !== 'boolean' || typeof result.renderer !== 'string' || typeof result.vendor !== 'string' || typeof result.webgl2 !== 'boolean' || typeof result.extColorBufferFloat !== 'boolean') {
    return { reason: `the capability page failed: ${pageError(result, 'no WebGL context')}` };
  }
  if (result.renderer.length === 0) return { reason: `the capability page failed: ${pageError(result, 'no WebGL context')}` };
  if (!result.ok) return { reason: `the capability page could not draw a frame${typeof result.error === 'string' && result.error.length > 0 ? `: ${result.error}` : ''}` };
  return {
    report: {
      renderer: result.renderer,
      vendor: result.vendor,
      webgl2: result.webgl2,
      hardware: isHardwareRenderer(result.renderer),
      extColorBufferFloat: result.extColorBufferFloat,
    },
  };
}

async function closeQuietly(context: BrowserContext | undefined): Promise<void> {
  if (context === undefined) return;
  try {
    await context.close();
  } catch {
    // The browser may already be gone; nothing to clean up.
  }
}

/**
 * Launches the browser headless (640x360, device scale factor 1, the render
 * launch arguments) on a profile under `<dataDir>/profiles/doctor-<channel>`,
 * loads the capability page and returns its report. The profile is removed
 * afterwards. Any failure (no browser, launch refused by policy, no WebGL
 * context, timeout) yields null with the reason, which the caller records
 * as a problem; nothing throws. Aborting the signal while the browser runs
 * closes it, which makes the pending page call fail like any other failure.
 */
export async function readBrowserCapabilities(browser: BrowserToCheck, dataDir: string, log: Logger, signal: AbortSignal): Promise<CapabilityCheck> {
  if (signal.aborted) return { report: null, reason: 'the check was cancelled before it started' };
  const profileDir = capabilityProfileDir(dataDir, browser.channel);
  let context: BrowserContext | undefined;
  const onAbort = (): void => { void closeQuietly(context); };
  try {
    ensureDirectory(profileDir);
    context = await chromium.launchPersistentContext(profileDir, {
      channel: browser.channel,
      executablePath: browser.path,
      headless: true,
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 1,
      args: [...capabilityLaunchArgs],
      timeout: browserLaunchTimeoutMs,
    });
    if (signal.aborted) return { report: null, reason: 'the check was cancelled' };
    signal.addEventListener('abort', onAbort, { once: true });
    const page = context.pages()[0] ?? await context.newPage();
    await page.setContent(webglCapabilityPage, { waitUntil: 'load', timeout: browserLaunchTimeoutMs });
    const json = await page.evaluate<string>('String(window.capsJson)');
    const parsed = parseCapabilityJson(json);
    if (parsed.report === undefined) {
      const reason = parsed.reason ?? 'the capability page reported nothing';
      log.debug(`${browser.channel}: ${reason}`);
      return { report: null, reason };
    }
    return { report: parsed.report };
  } catch (error: unknown) {
    const reason = signal.aborted ? 'the check was cancelled' : error instanceof Error ? error.message.split(/\r?\n/)[0] ?? error.message : String(error);
    log.debug(`${browser.channel}: the WebGL check failed: ${reason}`);
    return { report: null, reason };
  } finally {
    signal.removeEventListener('abort', onAbort);
    await closeQuietly(context);
    try {
      await removeDirectoryWithRetry(profileDir);
    } catch (error: unknown) {
      log.debug(`${browser.channel}: could not remove the profile ${profileDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
