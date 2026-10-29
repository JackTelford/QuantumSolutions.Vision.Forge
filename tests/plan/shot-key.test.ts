import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { browserLaunchFlags, emptyFingerprint, fingerprintFromManifest, lookContent, majorVersion, renderFingerprint, shotKey, shotKeyInput } from '../../src/plan/shot-key.ts';
import type { RenderFingerprint } from '../../src/plan/shot-key.ts';
import type { ToolsManifest } from '../../src/shared/contracts/tools.ts';
import { requiredEncoders, requiredFilters } from '../../src/tools/ffmpeg-info.ts';
import { writeToolsManifest } from '../../src/tools/tools-manifest.ts';
import { mutated } from '../schema/documents/examples.ts';
import { planLook, planShotSpec } from './fixtures.ts';

const hex64 = /^[0-9a-f]{64}$/;
const fingerprint: RenderFingerprint = { laneCodeHash: 'a'.repeat(64), browserMajor: 156, browserFlags: [...browserLaunchFlags] };
const shot = planShotSpec.shots[0]!;

const manifest: ToolsManifest = {
  kind: 'tools',
  version: 1,
  generatedAt: '2026-10-26T20:00:00.000Z',
  platform: { os: 'win32', arch: 'x64', release: '10.0.26300' },
  node: { path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v24.13.0' },
  interactiveSession: true,
  longPathsEnabled: false,
  programs: {
    ffmpeg: { path: 'C:\\ffmpeg\\bin\\ffmpeg.exe', version: '9.0.2', filters: [...requiredFilters], encoders: [...requiredEncoders] },
    ffprobe: { path: 'C:\\ffmpeg\\bin\\ffprobe.exe', version: '9.0.2' },
  },
  browsers: [
    { channel: 'msedge', path: 'C:\\Edge\\msedge.exe', version: '156.0.4314.42', webgl: null },
    { channel: 'chrome', path: 'C:\\Chrome\\chrome.exe', version: '157.0.8078.47', webgl: { renderer: 'ANGLE (NVIDIA, D3D11)', vendor: 'Google Inc. (NVIDIA)', webgl2: true, hardware: true, extColorBufferFloat: true } },
  ],
  gpu: null,
  lanes: { html: true, three: true, blender: false, audio: true },
  narration: { installed: false, weightsVerified: false },
  problems: [],
};

describe('shotKey', () => {
  it('is 64 lowercase hex characters and stable for the same inputs', async () => {
    const first = await shotKey(shot, planLook, fingerprint);
    const second = await shotKey(shot, planLook, fingerprint);
    assert.match(first, hex64);
    assert.equal(first, second);
  });

  it('hashes the shot, the look without createdAt and the three fingerprint fields', () => {
    const input = shotKeyInput(shot, planLook, fingerprint);
    assert.deepEqual(Object.keys(input).sort(), ['browserFlags', 'browserMajor', 'laneCodeHash', 'look', 'shot']);
    assert.equal('createdAt' in input.look, false);
    assert.equal(input.look.id, planLook.id);
    assert.equal('createdAt' in lookContent(planLook), false);
  });

  it('changes when a shot field changes', async () => {
    const original = await shotKey(shot, planLook, fingerprint);
    const longer = await shotKey({ ...shot, durationFrames: shot.durationFrames + 1 }, planLook, fingerprint);
    const otherLens = await shotKey({ ...shot, lens: { ...shot.lens, fStop: 4 } }, planLook, fingerprint);
    const otherProfile = await shotKey({ ...shot, renderProfile: { engine: 'chromium', backend: 'swiftshader-webgl', renderer: 'software' } }, planLook, fingerprint);
    assert.notEqual(longer, original);
    assert.notEqual(otherLens, original);
    assert.notEqual(otherProfile, original);
  });

  it('changes when the look changes, but not when only its createdAt changes', async () => {
    const original = await shotKey(shot, planLook, fingerprint);
    const regraded = await shotKey(shot, mutated(planLook, (copy) => { copy.grade.saturation = 1.2; }), fingerprint);
    const retimed = await shotKey(shot, mutated(planLook, (copy) => { copy.createdAt = '2026-11-01T00:00:00.000Z'; }), fingerprint);
    assert.notEqual(regraded, original);
    assert.equal(retimed, original);
  });

  it('changes with the browser major version, the launch flags and the lane code hash', async () => {
    const original = await shotKey(shot, planLook, fingerprint);
    assert.notEqual(await shotKey(shot, planLook, { ...fingerprint, browserMajor: 157 }), original);
    assert.notEqual(await shotKey(shot, planLook, { ...fingerprint, browserFlags: [] }), original);
    assert.notEqual(await shotKey(shot, planLook, { ...fingerprint, laneCodeHash: 'b'.repeat(64) }), original);
    assert.notEqual(await shotKey(shot, planLook, emptyFingerprint), original);
  });
});

describe('renderFingerprint', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-fingerprint-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads the major version of a dotted browser version', () => {
    assert.equal(majorVersion('156.0.4314.42'), 156);
    assert.equal(majorVersion('157'), 157);
    assert.equal(majorVersion('unknown'), null);
  });

  it('is the empty fingerprint when the data directory has no tools.json', () => {
    assert.deepEqual(renderFingerprint(join(dir, 'no-manifest')), { laneCodeHash: '', browserMajor: null, browserFlags: [] });
  });

  it('takes the major of the first browser with a WebGL report and the constant launch flags from tools.json', () => {
    const dataDir = join(dir, 'data');
    writeToolsManifest(dataDir, manifest);
    assert.deepEqual(renderFingerprint(dataDir), { laneCodeHash: '', browserMajor: 157, browserFlags: ['--force-device-scale-factor=1', '--disable-lcd-text'] });
  });

  it('records a null major when no browser has a WebGL report', () => {
    const unchecked: ToolsManifest = { ...manifest, browsers: manifest.browsers.map((browser) => ({ ...browser, webgl: null })) };
    assert.equal(fingerprintFromManifest(unchecked).browserMajor, null);
    assert.equal(fingerprintFromManifest({ ...manifest, browsers: [] }).browserMajor, null);
  });
});
