/**
 * Browser helpers shared by the M0 browser probes (P3, P4, P5).
 *
 * - A small static HTTP server that can serve TypeScript files stripped to
 *   JavaScript with Node's own stripper (the harness design under test).
 * - Playwright launch through a persistent context on a system Edge or Chrome
 *   channel with a fixed viewport and device scale factor.
 * - A WebGL capability page and its reader.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import { chromePath, edgePath, killProcessesMentioning } from './lib.ts';

/** A URL prefix mapped to a directory on disk. */
export interface ServedRoot {
  readonly urlPrefix: string;
  readonly directory: string;
}

/** A running static server. */
export interface StaticServer {
  readonly port: number;
  readonly url: string;
  readonly close: () => Promise<void>;
}

const mimeTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
};

function resolveWithinRoot(root: ServedRoot, urlPath: string): string | undefined {
  const relativePart = decodeURIComponent(urlPath.slice(root.urlPrefix.length));
  const base = resolve(root.directory);
  const target = normalize(resolve(base, relativePart));
  if (target !== base && !target.startsWith(base + sep)) return undefined;
  return target;
}

function handleRequest(roots: readonly ServedRoot[], request: IncomingMessage, response: ServerResponse): void {
  const urlPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (urlPath === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  const root = roots.find((r) => urlPath.startsWith(r.urlPrefix));
  const target = root === undefined ? undefined : resolveWithinRoot(root, urlPath);
  if (target === undefined || !existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`not found: ${urlPath}`);
    return;
  }
  const extension = extname(target).toLowerCase();
  const contentType = mimeTypes[extension] ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
  if (extension === '.ts') {
    const source = readFileSync(target, 'utf8');
    const stripped = stripTypeScriptTypes(source, { mode: 'strip' });
    response.writeHead(200, headers);
    response.end(stripped);
    return;
  }
  response.writeHead(200, headers);
  response.end(readFileSync(target));
}

/** Starts a loopback static server for the given roots on a free port. */
export function startStaticServer(roots: readonly ServedRoot[]): Promise<StaticServer> {
  return new Promise<StaticServer>((resolvePromise, rejectPromise) => {
    const server: Server = createServer((request, response) => {
      try {
        handleRequest(roots, request, response);
      } catch (error: unknown) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
    server.on('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        rejectPromise(new Error('static server did not report a port'));
        return;
      }
      resolvePromise({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** Browser channels this machine offers, Edge first. */
export type Channel = 'msedge' | 'chrome';

/** Channels whose executable exists on this machine. */
export function availableChannels(): readonly Channel[] {
  const channels: Channel[] = [];
  if (edgePath() !== undefined) channels.push('msedge');
  if (chromePath() !== undefined) channels.push('chrome');
  return channels;
}

/** Launch arguments every probe adds on top of Playwright's own defaults. */
export const baseArgs: readonly string[] = ['--force-device-scale-factor=1'];

/** Options for launching a probe browser. */
export interface LaunchSpec {
  readonly channel: Channel;
  readonly profileDir: string;
  readonly args: readonly string[];
  readonly width?: number;
  readonly height?: number;
}

/** Launches a persistent headless context with a fixed viewport and DPR 1. */
export function launchContext(spec: LaunchSpec): Promise<BrowserContext> {
  return chromium.launchPersistentContext(spec.profileDir, {
    channel: spec.channel,
    headless: true,
    viewport: { width: spec.width ?? 1920, height: spec.height ?? 1080 },
    deviceScaleFactor: 1,
    args: [...spec.args],
    timeout: 60_000,
  });
}

/** Closes a context, ignoring errors from an already dead browser. */
export async function closeQuietly(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // The browser may already be gone; nothing to clean up.
  }
}

/** Removes a profile directory with retries, after killing browsers still holding it. */
export async function removeProfileDir(dir: string): Promise<void> {
  await killProcessesMentioning(dir);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise<void>((done) => setTimeout(done, 250 * (attempt + 1)));
    }
  }
}

/** What a WebGL context reports about itself. */
export interface WebglCapabilities {
  readonly ok: boolean;
  readonly error: string;
  readonly webgl2: boolean;
  readonly renderer: string;
  readonly vendor: string;
  readonly version: string;
  readonly extColorBufferFloat: boolean;
  readonly oesTextureFloatLinear: boolean;
  readonly maxTextureSize: number;
  readonly maxRenderbufferSize: number;
  readonly devicePixelRatio: number;
  readonly userAgent: string;
  readonly firstFrameMs: number;
}

/** HTML of a page that creates a WebGL2 (or WebGL) context, draws one frame and exposes `window.capsJson`. */
export const webglCapabilityPage: string = `<!doctype html><html><head><meta charset="utf-8"><title>webgl caps</title></head>
<body style="margin:0;background:#202020">
<canvas id="c" width="640" height="360"></canvas>
<script>
(function () {
  const out = { ok: false, error: '', webgl2: false, renderer: '', vendor: '', version: '', extColorBufferFloat: false, oesTextureFloatLinear: false, maxTextureSize: 0, maxRenderbufferSize: 0, devicePixelRatio: window.devicePixelRatio, userAgent: navigator.userAgent, firstFrameMs: 0 };
  try {
    const t0 = performance.now();
    const canvas = document.getElementById('c');
    let gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    out.webgl2 = gl !== null;
    if (gl === null) gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (gl === null) throw new Error('no WebGL context');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    out.vendor = info ? String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR));
    out.version = String(gl.getParameter(gl.VERSION));
    out.extColorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null;
    out.oesTextureFloatLinear = gl.getExtension('OES_texture_float_linear') !== null;
    out.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    out.maxRenderbufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.finish();
    const px = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.firstFrameMs = performance.now() - t0;
    out.ok = px[2] > 100;
  } catch (e) { out.error = String(e && e.message ? e.message : e); }
  window.capsJson = JSON.stringify(out);
})();
</script></body></html>`;

/** Loads the capability page into a page and reads its result. */
export async function readWebglCapabilities(page: Page): Promise<WebglCapabilities> {
  await page.setContent(webglCapabilityPage, { waitUntil: 'load' });
  const json = await page.evaluate<string>('window.capsJson');
  return JSON.parse(json) as WebglCapabilities;
}

/** True when a renderer string names real hardware rather than a software rasterizer. */
export function isHardwareRenderer(renderer: string): boolean {
  return /NVIDIA|AMD|Radeon|Intel|Apple|Qualcomm/i.test(renderer) && !/SwiftShader|SwANGLE|WARP|Basic Render|llvmpipe/i.test(renderer);
}

/** Short label for a profile directory under a probe scratch root. */
export function profileDir(probeDir: string, runName: string): string {
  return join(probeDir, 'profiles', runName);
}
