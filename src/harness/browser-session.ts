/**
 * The BrowserRenderer of types.ts implemented with Playwright on the system
 * browser (ADR 0006): one persistent headless context launched with exactly
 * the shot key's flag set plus the renderer's --use-angle choice, checked
 * against the renderer policy through the capability page, then one page
 * per capture that is initialised with the shot spec, seeked frame by frame
 * and screenshotted with animations allowed. Nothing here depends on wall
 * time: the page renders frame k inside __vfSeek(k) before the screenshot.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import type { Logger } from '../cli/logger.ts';
import { CancelledError, VisionForgeError } from '../errors/vision-forge-error.ts';
import { ensureDirectory, removeDirectoryWithRetry } from '../fs/paths.ts';
import type { RenderProfile, Renderer } from '../shared/contracts/shot-spec.ts';
import type { Channel } from '../shared/contracts/tools.ts';
import type { InitReport, SeekReport } from '../shared/harness/protocol.ts';
import { isHardwareRenderer, parseCapabilityJson, webglCapabilityPage } from '../tools/browser-capabilities.ts';
import { PageInitError, PageSeekError, RendererMismatchError } from './page-error.ts';
import { browserArgs, browserRenderProfile } from './types.ts';
import type { BrowserFingerprint, BrowserRenderer, CaptureRequest, CapturedFrame, RendererPolicy } from './types.ts';

/** How long a launch may take. */
export const launchTimeoutMs = 60_000;

/** How long a page load may take. */
export const pageLoadTimeoutMs = 60_000;

/** How long the runtime may take to install __vfInit after the page loaded. */
export const protocolTimeoutMs = 30_000;

/** How long __vfInit may take to settle (fonts, an HDRI or a model load); evaluate itself never times out. */
export const initTimeoutMs = 60_000;

/** How many console lines an error message carries. */
export const consoleTailLength = 10;

/** What openBrowserRenderer needs. */
export interface OpenBrowserOptions {
  readonly channel: Channel;
  readonly executablePath: string;
  /** The browser's full version, as tools.json records it; recorded in the fingerprint. */
  readonly version: string;
  readonly dataDir: string;
  readonly policy: RendererPolicy;
  readonly width: number;
  readonly height: number;
  readonly log: Logger;
  readonly platform?: NodeJS.Platform;
  /** Overrides initTimeoutMs; tests use a short one to prove a hanging init fails. */
  readonly initTimeoutMs?: number;
}

/** The two functions the runtime installs on window (pageGlobalNames in protocol.ts), as the harness calls them. */
interface ProtocolGlobals {
  readonly __vfInit: (specJson: string) => Promise<string>;
  readonly __vfSeek: (frame: number) => string;
}

/**
 * The profile directory of a render: one per channel and process, so two
 * processes never share a browser profile. Within one process a channel
 * holds one renderer at a time; openBrowserRenderer refuses a second one
 * while the first is open, because Chromium locks the profile.
 */
export function renderProfileDir(dataDir: string, channel: Channel, pid: number = process.pid): string {
  return join(dataDir, 'profiles', `render-${channel}-${String(pid)}`);
}

/** The profile directories this process has a browser open on; launch adds, removeProfile deletes. */
const openProfiles = new Set<string>();

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split(/\r?\n/)[0] ?? text;
}

/** The parsed report when it is a JSON object whose fields have the expected types, or undefined. */
function parseReport<T extends { readonly ok: boolean; readonly error: string }>(json: unknown, fields: Readonly<Record<string, 'number' | 'array'>>): T | undefined {
  if (typeof json !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record['ok'] !== 'boolean' || typeof record['error'] !== 'string') return undefined;
  for (const [name, kind] of Object.entries(fields)) {
    const value = record[name];
    if (kind === 'array' ? !Array.isArray(value) : typeof value !== 'number') return undefined;
  }
  return parsed as T;
}

/** What one launch produced: the context, the renderer string the capability page read (or the reason it could not), and the args used. */
interface Launched {
  readonly context: BrowserContext;
  readonly args: readonly string[];
  readonly webglRenderer: string | undefined;
  readonly reason: string;
}

async function closeQuietly(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // The browser may already be gone; nothing to clean up.
  }
}

/** Removes a profile directory after the browser closed; a failure (a lock file still held) is a warning, never a crash. */
async function removeProfile(profileDir: string, log: Logger): Promise<void> {
  openProfiles.delete(profileDir);
  try {
    await removeDirectoryWithRetry(profileDir);
  } catch (error: unknown) {
    log.warn(`Could not remove the browser profile ${profileDir}: ${firstLine(error)}`);
  }
}

/**
 * Launches the browser for a renderer and reads its WebGL renderer string
 * through the capability page. Whatever fails, the profile directory does
 * not stay behind: a failed run must not leave a cache per pid under the
 * data directory.
 */
async function launch(options: OpenBrowserOptions, renderer: Renderer, profileDir: string, platform: NodeJS.Platform): Promise<Launched> {
  const args = browserArgs(renderer, platform);
  let context: BrowserContext | undefined;
  try {
    ensureDirectory(profileDir);
    openProfiles.add(profileDir);
    context = await chromium.launchPersistentContext(profileDir, {
      channel: options.channel,
      executablePath: options.executablePath,
      headless: true,
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
      args: [...args],
      timeout: launchTimeoutMs,
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.setContent(webglCapabilityPage, { waitUntil: 'load', timeout: pageLoadTimeoutMs });
    const parsed = parseCapabilityJson(await page.evaluate<string>('String(window.capsJson)'));
    // The capability page keeps a WebGL context alive; the initial page is parked on about:blank instead of closed, which keeps the context open.
    await page.goto('about:blank');
    options.log.debug(`browser: ${options.channel} launched with ${args.join(' ')}; WebGL ${parsed.report?.renderer ?? `unavailable (${parsed.reason ?? 'no report'})`}`);
    return { context, args, webglRenderer: parsed.report?.renderer, reason: parsed.reason ?? 'no WebGL report' };
  } catch (error: unknown) {
    if (context !== undefined) await closeQuietly(context);
    await removeProfile(profileDir, options.log);
    throw error;
  }
}

/** The BrowserRenderer over one launched context. */
class PlaywrightRenderer implements BrowserRenderer {
  readonly profile: RenderProfile;
  readonly fingerprint: BrowserFingerprint;
  private readonly context: BrowserContext;
  private readonly profileDir: string;
  private readonly log: Logger;
  private readonly width: number;
  private readonly height: number;
  private readonly initTimeoutMs: number;
  private readonly signal: AbortSignal;
  private readonly onAbort: () => void;
  private closing: Promise<void> | undefined;

  constructor(context: BrowserContext, profileDir: string, profile: RenderProfile, fingerprint: BrowserFingerprint, options: OpenBrowserOptions, signal: AbortSignal) {
    this.context = context;
    this.profileDir = profileDir;
    this.profile = profile;
    this.fingerprint = fingerprint;
    this.log = options.log;
    this.width = options.width;
    this.height = options.height;
    this.initTimeoutMs = options.initTimeoutMs ?? initTimeoutMs;
    this.signal = signal;
    this.onAbort = (): void => { void this.close(); };
    this.closing = undefined;
    signal.addEventListener('abort', this.onAbort, { once: true });
  }

  /** Opens the page, initialises it with the spec and screenshots every requested frame in order. */
  async capture(request: CaptureRequest, signal: AbortSignal, onFrame?: (frame: CapturedFrame) => void): Promise<readonly CapturedFrame[]> {
    if (signal.aborted) throw new CancelledError();
    if (this.closing !== undefined) throw browserClosedError('The browser was closed before the capture started.');
    let page: Page;
    try {
      page = await this.context.newPage();
    } catch (error: unknown) {
      // An abort closes the context while newPage is in flight; a crashed browser rejects the same way.
      if (signal.aborted) throw new CancelledError();
      throw browserClosedError(`The browser could not open a page: ${firstLine(error)}.`, error);
    }
    const consoleTail: string[] = [];
    const remember = (line: string): void => {
      this.log.debug(`page console: ${line}`);
      consoleTail.push(line);
      if (consoleTail.length > consoleTailLength) consoleTail.shift();
    };
    page.on('console', (message) => { if (message.type() === 'error') remember(message.text()); });
    page.on('pageerror', (error) => { remember(error.message); });
    try {
      await this.initialise(page, request, signal, consoleTail);
      const captured: CapturedFrame[] = [];
      for (const frame of request.frames) {
        if (signal.aborted) throw new CancelledError();
        const record = await this.captureFrame(page, request, frame, signal, consoleTail);
        captured.push(record);
        onFrame?.(record);
      }
      return captured;
    } finally {
      try {
        await page.close();
      } catch {
        // The context may already be closing (abort); the page goes with it.
      }
    }
  }

  /** Closes the browser and removes its profile; a second call returns the first call's promise. */
  close(): Promise<void> {
    if (this.closing === undefined) this.closing = this.closeOnce();
    return this.closing;
  }

  private async closeOnce(): Promise<void> {
    this.signal.removeEventListener('abort', this.onAbort);
    await closeQuietly(this.context);
    await removeProfile(this.profileDir, this.log);
  }

  private async initialise(page: Page, request: CaptureRequest, signal: AbortSignal, consoleTail: readonly string[]): Promise<void> {
    let initJson: unknown;
    let timer: NodeJS.Timeout | undefined;
    try {
      const response = await page.goto(request.pageUrl, { waitUntil: 'load', timeout: pageLoadTimeoutMs });
      // A 404 or 500 still "loads", and waiting for the protocol on an error page would only time out 30 s later.
      if (response !== null && !response.ok()) throw new PageInitError(request.pageUrl, `The harness answered HTTP ${String(response.status())} for the page.`, consoleTail);
      await page.waitForFunction('typeof window.__vfInit === "function"', undefined, { timeout: protocolTimeoutMs });
      // evaluate never times out on its own; a page whose init never settles would hang the command silently.
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new PageInitError(request.pageUrl, `The page's init did not finish within ${String(this.initTimeoutMs / 1000)} s.`, consoleTail)); }, this.initTimeoutMs);
      });
      initJson = await Promise.race([page.evaluate((json: string) => (globalThis as unknown as ProtocolGlobals).__vfInit(json), JSON.stringify(request.spec)), expired]);
    } catch (error: unknown) {
      if (signal.aborted) throw new CancelledError();
      if (error instanceof VisionForgeError) throw error;
      throw new PageInitError(request.pageUrl, `The page did not become ready: ${firstLine(error)}.`, consoleTail);
    } finally {
      clearTimeout(timer);
    }
    const report = parseReport<InitReport>(initJson, { animations: 'number', fonts: 'array' });
    if (report === undefined) throw new PageInitError(request.pageUrl, `The page's init report is not an InitReport: ${String(initJson).slice(0, 200)}.`, consoleTail);
    if (!report.ok) throw new PageInitError(request.pageUrl, report.error.length > 0 ? report.error : 'The page reported an init failure without a message.', consoleTail);
    if (report.animations !== 0) {
      throw new PageInitError(request.pageUrl, `The page has ${String(report.animations)} running animation(s) after init; a page renders by frame number only (ADR 0006 decision 1).`, consoleTail);
    }
    this.log.debug(`browser: page ready, fonts ${report.fonts.length === 0 ? 'none' : report.fonts.join(', ')}, WebGL ${report.webglRenderer ?? 'none'}`);
    request.onInit?.(report);
  }

  private async captureFrame(page: Page, request: CaptureRequest, frame: number, signal: AbortSignal, consoleTail: readonly string[]): Promise<CapturedFrame> {
    let seekJson: unknown;
    try {
      seekJson = await page.evaluate((k: number) => (globalThis as unknown as ProtocolGlobals).__vfSeek(k), frame);
    } catch (error: unknown) {
      if (signal.aborted) throw new CancelledError();
      throw new PageSeekError(request.pageUrl, frame, `the seek threw: ${firstLine(error)}.`, consoleTail);
    }
    const report = parseReport<SeekReport>(seekJson, { frame: 'number' });
    if (report === undefined) throw new PageSeekError(request.pageUrl, frame, `the seek report is not a SeekReport: ${String(seekJson).slice(0, 200)}.`, consoleTail);
    if (!report.ok) throw new PageSeekError(request.pageUrl, frame, report.error.length > 0 ? report.error : 'the page reported a seek failure without a message.', consoleTail);
    const path = request.framePath(frame);
    const started = process.hrtime.bigint();
    try {
      // animations 'allow' on purpose: 'disabled' finishes animations and destroys the seeked frame (probe P5).
      // A text plate is captured without the browser's default background, so the PNG keeps alpha where the page painted nothing (ADR 0008 decision 4).
      await page.screenshot({ path, type: 'png', animations: 'allow', caret: 'hide', scale: 'css', omitBackground: request.spec.plate === 'text', clip: { x: 0, y: 0, width: this.width, height: this.height } });
    } catch (error: unknown) {
      if (signal.aborted) throw new CancelledError();
      throw new PageSeekError(request.pageUrl, frame, `the screenshot failed: ${firstLine(error)}.`, consoleTail);
    }
    const screenshotMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return { frame, path, screenshotMs };
  }
}

function browserClosedError(message: string, cause?: unknown): VisionForgeError {
  return new VisionForgeError({ code: 'browser-closed', message, hint: 'The browser was closed or crashed; run the command again.', ...(cause === undefined ? {} : { cause }) });
}

function assertDataDir(dataDir: string): void {
  let isDirectory: boolean;
  try {
    isDirectory = existsSync(dataDir) && statSync(dataDir).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new VisionForgeError({ code: 'data-dir', message: `The data directory ${dataDir} does not exist.`, hint: 'Run "doctor" first, or pass --data-dir <existing directory>.' });
  }
}

/**
 * Launches the browser under the policy and returns the renderer. A fixed
 * policy launches once and fails on a mismatch; `any` launches for hardware
 * first and falls back to software when that gives no usable WebGL
 * context, then accepts whatever renderer string comes back. An abort
 * during the launch is honoured once the launch has finished (the browser
 * is then closed and the profile removed); after that an abort closes the
 * browser at once.
 */
export async function openBrowserRenderer(options: OpenBrowserOptions, signal: AbortSignal): Promise<BrowserRenderer> {
  if (signal.aborted) throw new CancelledError();
  assertDataDir(options.dataDir);
  const platform = options.platform ?? process.platform;
  const profileDir = renderProfileDir(options.dataDir, options.channel);
  if (openProfiles.has(profileDir)) {
    throw new VisionForgeError({ code: 'browser-profile-in-use', message: `A ${options.channel} renderer is already open on ${profileDir}.`, hint: 'Close the open renderer before opening another one for the same browser channel.' });
  }
  // A reused pid must not start on a profile a crashed run left behind.
  await removeProfile(profileDir, options.log);
  const firstRenderer: Renderer = options.policy === 'software' ? 'software' : 'hardware';
  let launched = await launch(options, firstRenderer, profileDir, platform);
  if (options.policy === 'any' && launched.webglRenderer === undefined && !signal.aborted) {
    options.log.info(`The ${options.channel} hardware launch has no usable WebGL context (${launched.reason}); relaunching with the software renderer.`);
    await closeQuietly(launched.context);
    await removeProfile(profileDir, options.log);
    launched = await launch(options, 'software', profileDir, platform);
  }
  const classified = classify(options.policy, launched);
  if (classified === undefined || signal.aborted) {
    await closeQuietly(launched.context);
    await removeProfile(profileDir, options.log);
    throw signal.aborted ? new CancelledError() : mismatchError(options.policy, launched);
  }
  const fingerprint: BrowserFingerprint = { channel: options.channel, version: options.version, args: launched.args, webglRenderer: launched.webglRenderer ?? '' };
  return new PlaywrightRenderer(launched.context, profileDir, browserRenderProfile(classified, platform), fingerprint, options, signal);
}

/** The renderer a launch is recorded as: what the renderer string says; undefined when the policy is fixed and the browser offers something else. */
function classify(policy: RendererPolicy, launched: Launched): Renderer | undefined {
  if (launched.webglRenderer === undefined) return undefined;
  const classified: Renderer = isHardwareRenderer(launched.webglRenderer) ? 'hardware' : 'software';
  return policy === 'any' || classified === policy ? classified : undefined;
}

function mismatchError(policy: RendererPolicy, launched: Launched): RendererMismatchError {
  return new RendererMismatchError(policy, launched.webglRenderer ?? `no usable WebGL context (${launched.reason})`);
}
