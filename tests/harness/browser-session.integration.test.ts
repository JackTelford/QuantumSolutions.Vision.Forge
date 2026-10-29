import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { CancelledError, VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import { openBrowserRenderer, renderProfileDir } from '../../src/harness/browser-session.ts';
import type { OpenBrowserOptions } from '../../src/harness/browser-session.ts';
import { HarnessServer } from '../../src/harness/harness-server.ts';
import { PageInitError } from '../../src/harness/page-error.ts';
import { browserArgs } from '../../src/harness/types.ts';
import type { BrowserRenderer, CaptureRequest, CapturedFrame } from '../../src/harness/types.ts';
import { isHardwareRenderer } from '../../src/tools/browser-capabilities.ts';
import { findBrowsers } from '../../src/tools/browsers.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import type { ShotPageSpec } from '../../src/shared/harness/protocol.ts';
import { browserLaunchFlags } from '../../src/plan/shot-key.ts';
import { lookBibleExample, shotExample } from '../schema/documents/examples.ts';

const browser = findBrowsers().found[0];
const skip = browser === undefined ? 'no browser is installed' : false;
const ffmpeg = findFfmpeg()?.path;
const width = 640;
const height = 360;
const never = new AbortController().signal;

/** The fixture ignores the spec's content; a sound shot and look keep the request well typed. */
const spec: ShotPageSpec = { lane: 'html', fps: 30, width, height, shot: shotExample('s01', 30, 'html'), look: lookBibleExample, camera: [], baseDistanceM: 1, fontsUrl: '/fonts/', assetsUrl: '/assets/' };

/** The options every open in this file shares; the data directory and the policy vary per test. */
function openOptions(dataDir: string, log: MemoryLogger, extra: Partial<OpenBrowserOptions> = {}): OpenBrowserOptions {
  assert.ok(browser !== undefined);
  return { channel: browser.channel, executablePath: browser.path, version: '0.0.0.0', dataDir, policy: 'any', width, height, log, ...extra };
}

/** The width and height a PNG declares in its IHDR chunk. */
function pngSize(path: string): { readonly width: number; readonly height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** One pixel of a PNG as "r,g,b", decoded by ffmpeg the way the QA checks decode frames. */
function pixelAt(ffmpegPath: string, pngPath: string, x: number, y: number): string {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', pngPath, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { shell: false, timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr.toString('utf8'));
  return Array.from(result.stdout.subarray(0, 3)).join(',');
}

describe('openBrowserRenderer against the installed browser', { skip }, () => {
  const log = new MemoryLogger();
  const server = new HarnessServer({
    roots: [
      { urlPrefix: '/page/', directory: join(import.meta.dirname, 'fixtures', 'protocol-page') },
      { urlPrefix: '/failing/', directory: join(import.meta.dirname, 'fixtures', 'protocol-page-failing') },
    ],
    log,
  });
  let dir = '';
  let dataDir = '';
  let renderer: BrowserRenderer | undefined;

  function request(frames: readonly number[], pagePath = '/page/index.html', folder = 'frames'): CaptureRequest {
    const framesDir = join(dir, folder);
    mkdirSync(framesDir, { recursive: true });
    return { pageUrl: `${server.url}${pagePath}`, spec, frames, framePath: (frame) => join(framesDir, `f${String(frame).padStart(4, '0')}.png`) };
  }

  /** A data directory of its own for a test that opens its own renderer: one process holds one renderer per channel and profile. */
  function ownDataDir(name: string): string {
    const own = join(dir, name);
    mkdirSync(own, { recursive: true });
    return own;
  }

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-session-'));
    dataDir = join(dir, 'data');
    mkdirSync(dataDir);
    await server.start(never);
    renderer = await openBrowserRenderer(openOptions(dataDir, log), never);
  }, { timeout: 120_000 });

  after(async () => {
    await renderer?.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }, { timeout: 60_000 });

  it('reports a renderer string, a profile that matches it and the exact launch flags', () => {
    assert.ok(renderer !== undefined && browser !== undefined);
    assert.ok(renderer.fingerprint.webglRenderer.length > 0, 'renderer string');
    assert.equal(renderer.profile.renderer, isHardwareRenderer(renderer.fingerprint.webglRenderer) ? 'hardware' : 'software');
    assert.equal(renderer.profile.engine, 'chromium');
    assert.equal(renderer.fingerprint.channel, browser.channel);
    assert.equal(renderer.fingerprint.version, '0.0.0.0');
    assert.deepEqual(renderer.fingerprint.args.slice(0, browserLaunchFlags.length), [...browserLaunchFlags]);
    assert.equal(renderer.fingerprint.args.length, browserLaunchFlags.length + 1);
    assert.ok(renderer.fingerprint.args[browserLaunchFlags.length]?.startsWith('--use-angle='));
    assert.ok(existsSync(renderProfileDir(dataDir, browser.channel)), 'profile directory in use');
  });

  it('refuses a second renderer on the same channel and data directory while the first is open', async () => {
    await assert.rejects(openBrowserRenderer(openOptions(dataDir, log), never), (error: unknown) => error instanceof VisionForgeError && error.code === 'browser-profile-in-use');
  });

  it('captures frames 0, 7 and 15 as three different PNGs of the frame size, reporting each as it lands', { timeout: 60_000 }, async () => {
    assert.ok(renderer !== undefined);
    const landed: number[] = [];
    const frames = await renderer.capture(request([0, 7, 15]), never, (frame: CapturedFrame) => { landed.push(frame.frame); });
    assert.deepEqual(frames.map((frame) => frame.frame), [0, 7, 15]);
    assert.deepEqual(landed, [0, 7, 15]);
    const bytes = frames.map((frame) => readFileSync(frame.path));
    for (const [index, frame] of frames.entries()) {
      assert.ok(existsSync(frame.path), frame.path);
      assert.deepEqual(pngSize(frame.path), { width, height });
      assert.ok(frame.screenshotMs > 0 && frame.screenshotMs < 10_000, `screenshot took ${frame.screenshotMs} ms`);
      for (let other = index + 1; other < bytes.length; other += 1) assert.notEqual(Buffer.compare(bytes[index] ?? Buffer.alloc(0), bytes[other] ?? Buffer.alloc(0)), 0, `frames ${frame.frame} and ${frames[other]?.frame} differ`);
    }
  });

  it('paints the seeked frame number into the pixels, as ffmpeg decodes them', { timeout: 60_000, skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, async () => {
    assert.ok(renderer !== undefined && ffmpeg !== undefined);
    const frames = await renderer.capture(request([0, 15], '/page/index.html', 'pixels'), never);
    // At frame 15 the box spans x 120 to 220 on a rgb(60, 51, 102) stage; at frame 0 it starts at x 0 on rgb(0, 51, 102).
    const frame0 = frames[0]?.path ?? '';
    const frame15 = frames[1]?.path ?? '';
    assert.equal(pixelAt(ffmpeg, frame15, 150, 180), '255,0,0', 'inside the box');
    assert.equal(pixelAt(ffmpeg, frame15, 50, 180), '60,51,102', 'stage left of the box');
    assert.equal(pixelAt(ffmpeg, frame0, 50, 180), '255,0,0', 'the box starts at x 0');
    assert.equal(pixelAt(ffmpeg, frame0, 300, 180), '0,51,102', 'stage at frame 0');
  });

  it('renders the same frame to the same bytes twice in one session', { timeout: 60_000 }, async () => {
    assert.ok(renderer !== undefined);
    const first = await renderer.capture(request([7], '/page/index.html', 'again-1'), never);
    const second = await renderer.capture(request([7], '/page/index.html', 'again-2'), never);
    assert.equal(Buffer.compare(readFileSync(first[0]?.path ?? ''), readFileSync(second[0]?.path ?? '')), 0);
  });

  it('throws PageInitError with the page sentence and the console tail when init reports ok: false, and logs the console line', { timeout: 60_000 }, async () => {
    assert.ok(renderer !== undefined);
    await assert.rejects(renderer.capture(request([0], '/failing/index.html', 'failing'), never), (error: unknown) => {
      assert.ok(error instanceof PageInitError, String(error));
      assert.equal(error.code, 'page-init');
      assert.ok(error.message.includes('The fixture refuses to initialise on purpose.'), error.message);
      assert.ok(error.message.includes('fixture: the init failure is deliberate'), error.message);
      return true;
    });
    assert.ok(log.messages.includes('debug: page console: fixture: the init failure is deliberate'), log.messages.join('\n'));
  });

  it('throws PageInitError when the page has a running animation after init', { timeout: 60_000 }, async () => {
    assert.ok(renderer !== undefined);
    await assert.rejects(renderer.capture(request([0], '/failing/index.html?animations', 'animations'), never), (error: unknown) => error instanceof PageInitError && /1 running animation/.test(error.message));
  });

  it('throws PageInitError with the HTTP status at once when the page does not exist', { timeout: 60_000 }, async () => {
    assert.ok(renderer !== undefined);
    const started = Date.now();
    await assert.rejects(renderer.capture(request([0], '/page/missing.html', 'missing'), never), (error: unknown) => error instanceof PageInitError && error.message.includes('HTTP 404'));
    assert.ok(Date.now() - started < 10_000, 'failed without waiting for the protocol');
  });

  it('throws PageInitError after the init timeout when the page\'s init never settles', { timeout: 60_000 }, async () => {
    const own = await openBrowserRenderer(openOptions(ownDataDir('data-hang'), log, { initTimeoutMs: 1_500 }), never);
    try {
      const started = Date.now();
      await assert.rejects(own.capture(request([0], '/failing/index.html?hang', 'hang'), never), (error: unknown) => error instanceof PageInitError && /did not finish within 1\.5 s/.test(error.message));
      assert.ok(Date.now() - started < 20_000, 'failed on the timeout, not on the test budget');
    } finally {
      await own.close();
    }
  });

  it('throws CancelledError before opening a page when the signal is already aborted', async () => {
    assert.ok(renderer !== undefined);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(renderer.capture(request([0], '/page/index.html', 'aborted'), controller.signal), (error: unknown) => error instanceof CancelledError);
  });

  it('stops with CancelledError when the signal aborts mid-capture, then closes and removes the profile', { timeout: 60_000 }, async () => {
    assert.ok(browser !== undefined);
    const abortDataDir = ownDataDir('data-abort');
    const own = await openBrowserRenderer(openOptions(abortDataDir, log), never);
    const controller = new AbortController();
    const landed: number[] = [];
    await assert.rejects(own.capture(request([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], '/page/index.html', 'mid'), controller.signal, (frame) => {
      landed.push(frame.frame);
      if (frame.frame === 1) controller.abort();
    }), (error: unknown) => error instanceof CancelledError);
    assert.deepEqual(landed, [0, 1]);
    await own.close();
    await own.close();
    assert.equal(existsSync(renderProfileDir(abortDataDir, browser.channel)), false, 'profile removed');
    await assert.rejects(own.capture(request([0], '/page/index.html', 'closed'), never), (error: unknown) => error instanceof VisionForgeError && error.code === 'browser-closed');
    // The profile is free again once the renderer closed.
    const again = await openBrowserRenderer(openOptions(abortDataDir, log), never);
    await again.close();
  });

  it('closes the browser when the open signal aborts, and a capture in flight ends with CancelledError', { timeout: 60_000 }, async () => {
    assert.ok(browser !== undefined);
    const signalDataDir = ownDataDir('data-signal');
    const controller = new AbortController();
    const own = await openBrowserRenderer(openOptions(signalDataDir, log), controller.signal);
    const landed: number[] = [];
    await assert.rejects(own.capture(request([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], '/page/index.html', 'signal'), controller.signal, (frame) => {
      landed.push(frame.frame);
      if (frame.frame === 0) controller.abort();
    }), (error: unknown) => error instanceof CancelledError);
    await own.close();
    assert.equal(existsSync(renderProfileDir(signalDataDir, browser.channel)), false, 'profile removed');
  });
});

describe('openBrowserRenderer with a fixed policy', { skip }, () => {
  const log = new MemoryLogger();
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-session-policy-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('renders with SwiftShader under policy software, records the software launch flags and starts on a clean profile', { timeout: 120_000 }, async () => {
    assert.ok(browser !== undefined);
    // A profile a crashed run of the same pid left behind must not be reused.
    const profileDir = renderProfileDir(dir, browser.channel);
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'stale.txt'), 'left behind', 'utf8');
    const renderer = await openBrowserRenderer(openOptions(dir, log, { policy: 'software' }), never);
    try {
      assert.match(renderer.fingerprint.webglRenderer, /SwiftShader/);
      assert.deepEqual(renderer.profile, { engine: 'chromium', backend: 'swiftshader-webgl', renderer: 'software' });
      assert.deepEqual(renderer.fingerprint.args, browserArgs('software'));
      assert.equal(existsSync(join(profileDir, 'stale.txt')), false, 'stale profile removed before the launch');
    } finally {
      await renderer.close();
    }
    assert.equal(existsSync(profileDir), false);
  });

  it('refuses a data directory that does not exist without launching', async () => {
    await assert.rejects(openBrowserRenderer(openOptions(join(dir, 'nowhere'), log), never), (error: unknown) => error instanceof VisionForgeError && error.code === 'data-dir');
  });

  it('removes the profile directory when the launch itself fails', { timeout: 60_000 }, async () => {
    assert.ok(browser !== undefined);
    const failDir = join(dir, 'launch-fails');
    mkdirSync(failDir);
    await assert.rejects(openBrowserRenderer(openOptions(failDir, log, { executablePath: join(failDir, 'no-such-browser.exe') }), never));
    assert.equal(existsSync(renderProfileDir(failDir, browser.channel)), false, 'profile removed after the failed launch');
  });
});
