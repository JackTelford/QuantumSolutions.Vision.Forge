import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { capabilityLaunchArgs, capabilityProfileDir, isHardwareRenderer, parseCapabilityJson, readBrowserCapabilities, webglCapabilityPage } from '../../src/tools/browser-capabilities.ts';
import { findBrowsers } from '../../src/tools/browsers.ts';

const never = new AbortController().signal;

const pageResult = { ok: true, error: '', webgl2: true, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', vendor: 'Google Inc. (Intel)', extColorBufferFloat: true, userAgent: 'x' };

describe('isHardwareRenderer', () => {
  it('recognizes the renderer strings probe P4 recorded', () => {
    assert.equal(isHardwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11)'), true);
    assert.equal(isHardwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'), false);
    assert.equal(isHardwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)'), false);
    assert.equal(isHardwareRenderer('ANGLE (Apple, Apple M2, OpenGL 4.1 Metal - 88)'), true);
    assert.equal(isHardwareRenderer('Mesa llvmpipe (LLVM 15.0.7, 256 bits)'), false);
    assert.equal(isHardwareRenderer('ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'), true);
  });
});

describe('parseCapabilityJson', () => {
  it('turns the page result into the report with the hardware flag derived from the renderer', () => {
    const parsed = parseCapabilityJson(JSON.stringify(pageResult));
    assert.deepEqual(parsed.report, { renderer: pageResult.renderer, vendor: 'Google Inc. (Intel)', webgl2: true, hardware: true, extColorBufferFloat: true });
    assert.equal(parsed.reason, undefined);
  });

  it('refuses a context that exists but could not draw the frame', () => {
    const parsed = parseCapabilityJson(JSON.stringify({ ...pageResult, ok: false, error: 'the cleared pixel read back as rgba(0, 0, 0, 0)' }));
    assert.equal(parsed.report, undefined);
    assert.equal(parsed.reason, 'the capability page could not draw a frame: the cleared pixel read back as rgba(0, 0, 0, 0)');
    assert.equal(parseCapabilityJson(JSON.stringify({ ...pageResult, ok: false })).reason, 'the capability page could not draw a frame');
    assert.match(parseCapabilityJson(JSON.stringify({ ...pageResult, ok: 'yes' })).reason ?? '', /failed/);
  });

  it('explains a page that could not create a context or returned something else', () => {
    assert.match(parseCapabilityJson(JSON.stringify({ ok: false, error: 'no WebGL context', webgl2: false, renderer: '', vendor: '', extColorBufferFloat: false, userAgent: 'x' })).reason ?? '', /no WebGL context/);
    assert.match(parseCapabilityJson('undefined').reason ?? '', /no JSON/);
    assert.match(parseCapabilityJson('[]').reason ?? '', /failed/);
    assert.match(parseCapabilityJson('null').reason ?? '', /no object/);
  });
});

describe('capability page and launch settings', () => {
  it('reads the unmasked renderer, WebGL2 and EXT_color_buffer_float, draws a frame and uses the render launch argument', () => {
    assert.match(webglCapabilityPage, /WEBGL_debug_renderer_info/);
    assert.match(webglCapabilityPage, /getContext\('webgl2'/);
    assert.match(webglCapabilityPage, /EXT_color_buffer_float/);
    assert.match(webglCapabilityPage, /readPixels/);
    assert.match(webglCapabilityPage, /window\.capsJson = JSON\.stringify/);
    assert.deepEqual(capabilityLaunchArgs, ['--force-device-scale-factor=1']);
    assert.equal(capabilityProfileDir('C:\\data', 'msedge'), join('C:\\data', 'profiles', 'doctor-msedge'));
  });
});

describe('readBrowserCapabilities against the installed browsers', () => {
  const browsers = findBrowsers().found;
  const skip = browsers.length === 0 ? 'no browser is installed' : false;
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-caps-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('reports a WebGL2 context from at least one browser and removes every profile afterwards', { skip, timeout: 240_000 }, async () => {
    const log = new MemoryLogger();
    let reports = 0;
    for (const browser of browsers) {
      const check = await readBrowserCapabilities(browser, dataDir, log, never);
      if (check.report === null) {
        assert.ok(check.reason !== undefined && check.reason.length > 0, `${browser.channel} failed without a reason`);
      } else {
        assert.equal(check.reason, undefined);
        assert.equal(check.report.webgl2, true);
        assert.ok(check.report.renderer.length > 0);
        assert.equal(check.report.hardware, isHardwareRenderer(check.report.renderer));
        reports += 1;
      }
      assert.equal(existsSync(capabilityProfileDir(dataDir, browser.channel)), false, `${browser.channel} profile removed`);
    }
    assert.ok(reports >= 1, `no browser reported WebGL:\n${log.messages.join('\n')}`);
  });

  it('returns null with the reason for an executable that is not a browser, logging only at debug level', { timeout: 120_000 }, async () => {
    const log = new MemoryLogger();
    const check = await readBrowserCapabilities({ channel: 'chrome', path: process.execPath }, dataDir, log, never);
    assert.equal(check.report, null);
    assert.ok(check.reason !== undefined && check.reason.length > 0 && !check.reason.includes('\n'), check.reason);
    assert.ok(log.messages.every((message) => message.startsWith('debug: ')), log.messages.join('\n'));
    assert.ok(log.messages.some((message) => message.startsWith('debug: chrome: the WebGL check failed: ')), log.messages.join('\n'));
  });

  it('returns null without launching when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const log = new MemoryLogger();
    assert.deepEqual(await readBrowserCapabilities({ channel: 'msedge', path: 'C:\\nowhere\\msedge.exe' }, dataDir, log, controller.signal), { report: null, reason: 'the check was cancelled before it started' });
    assert.deepEqual(log.messages, []);
  });

  it('closes the browser and reports the cancellation when the signal aborts during the check', { skip, timeout: 120_000 }, async () => {
    const controller = new AbortController();
    const log = new MemoryLogger();
    setTimeout(() => { controller.abort(); }, 50);
    const check = await readBrowserCapabilities(browsers[0] ?? { channel: 'msedge', path: '' }, dataDir, log, controller.signal);
    assert.deepEqual(check, { report: null, reason: 'the check was cancelled' });
    assert.equal(existsSync(capabilityProfileDir(dataDir, browsers[0]?.channel ?? 'msedge')), false);
  });
});
