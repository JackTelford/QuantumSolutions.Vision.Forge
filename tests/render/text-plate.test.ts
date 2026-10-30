import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../src/cli/logger.ts';
import type { BrowserRenderer } from '../../src/harness/types.ts';
import { emptyFingerprint, shotKey } from '../../src/plan/shot-key.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { framePath, shotCacheDir } from '../../src/render/cache.ts';
import { readManifest } from '../../src/render/manifest.ts';
import type { ManifestFingerprint } from '../../src/render/manifest.ts';
import type { RenderSeams } from '../../src/render/seams.ts';
import { captureTextPlateFrame, hasTextPlate, renderTextPlate, textPlateKey, textStillPath } from '../../src/render/text-plate.ts';
import type { TextPlateContext, TextPlateSession } from '../../src/render/text-plate.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeBrowserRenderer } from '../fakes/fake-browser-renderer.ts';
import { hex64, lookBibleExample, shotExample, textExample } from '../schema/documents/examples.ts';
import { fakePage, fingerprintExample, smallSpec } from './fixtures.ts';

const never = new AbortController().signal;
const ffmpeg = findFfmpeg();
const threeWithText = { ...shotExample('s01', 5, 'three'), text: [textExample] };

describe('hasTextPlate', () => {
  it('is true for a three or blender shot with text and false for an html shot or a shot without text', () => {
    assert.equal(hasTextPlate(threeWithText), true);
    assert.equal(hasTextPlate({ ...threeWithText, lane: 'blender' }), true);
    assert.equal(hasTextPlate({ ...threeWithText, lane: 'html' }), false);
    assert.equal(hasTextPlate(shotExample('s01', 5, 'three')), false);
  });
});

describe('textPlateKey', () => {
  it('derives a key of its own from the shot key and the html lane fingerprint, so the picture cache is untouched and an html change re-keys the plate', async () => {
    const picture = await shotKey(threeWithText, lookBibleExample, { ...emptyFingerprint, laneCodeHash: hex64('3') });
    const html = { laneCodeHash: hex64('a'), browserMajor: 156, browserFlags: ['--disable-lcd-text'] };
    const key = await textPlateKey(picture, html);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.notEqual(key, picture);
    assert.equal(await textPlateKey(picture, html), key, 'the same inputs give the same key');
    assert.notEqual(await textPlateKey(picture, { ...html, laneCodeHash: hex64('b') }), key, 'the html lane code re-keys the plate');
    assert.notEqual(await textPlateKey(picture, { ...html, browserMajor: 157 }), key, 'the browser re-keys the plate');
    assert.notEqual(await textPlateKey(hex64('f'), html), key, 'the shot key re-keys the plate');
  });
});

describe('textStillPath', () => {
  it('names the text plate frame beside a still', () => {
    assert.equal(textStillPath('C:\\j\\stills\\s01-r2.png'), 'C:\\j\\stills\\s01-r2.text.png');
  });
});

/** A session over the fake renderer and a seam that never opens anything: the page is the one-line fake, the fingerprint the Windows example. */
function fakeSession(renderer: BrowserRenderer, pageDir: string, fingerprint: ManifestFingerprint | undefined): TextPlateSession {
  const seams: RenderSeams = {
    ...fakePage,
    startHarness: () => Promise.reject(new Error('not opened here')),
    openRenderer: () => Promise.reject(new Error('not opened here')),
    manifestFingerprint: () => Promise.resolve(fingerprintExample),
    laneCodeHash: () => Promise.resolve(hex64('a')),
  };
  return {
    renderer, harness: { url: 'http://127.0.0.1:5123', stop: () => Promise.resolve() }, seams, pageDir,
    tools: { ffmpeg: { path: ffmpeg?.path ?? 'C:\\tools\\ffmpeg.exe', version: '9.0.2', filters: [], encoders: [] }, browser: { channel: 'msedge', path: 'C:\\edge.exe', version: '156.0.4314.42', webgl: null } },
    fingerprint,
  };
}

describe('renderTextPlate with a fake browser and the installed ffmpeg', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  let context: TextPlateContext;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-text-plate-'));
    context = { dataDir: dir, runner: new ChildProcessRunner(), log: new MemoryLogger(), signal: never, now: (): Date => new Date() };
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('asks the browser for the html lane\'s text plate of a three shot and records lane html and plate text in a manifest under the plate\'s own cache', async () => {
    const renderer = new FakeBrowserRenderer();
    const session = fakeSession(renderer, join(dir, 'page'), undefined);
    const key = hex64('7');
    const result = await renderTextPlate(session, context, { shot: threeWithText, look: lookBibleExample, spec: smallSpec, frames: [0, 1, 2], key, cacheDir: shotCacheDir(dir, key) });
    assert.equal(renderer.requests.length, 1);
    const spec = renderer.requests[0]?.spec;
    assert.equal(spec?.plate, 'text');
    assert.equal(spec?.lane, 'html', 'a three shot\'s text plate renders in the html lane');
    assert.equal(spec?.environment, null);
    assert.equal(result.framesDir, join(shotCacheDir(dir, key), 'frames'));
    for (const frame of [0, 1, 2]) assert.ok(existsSync(framePath(result.framesDir, frame)));
    const manifest = readManifest(result.manifestPath);
    assert.equal(manifest.lane, 'html');
    assert.equal(manifest.plate, 'text');
    assert.equal(manifest.key, key);
    assert.equal(manifest.status, 'rendering', 'three of five frames');
    assert.deepEqual(session.fingerprint, fingerprintExample, 'the html fingerprint is read once and kept on the session');
  });

  it('captures one uncached frame straight into a PNG for a scaled still', async () => {
    const renderer = new FakeBrowserRenderer();
    const session = fakeSession(renderer, join(dir, 'page-scaled'), fingerprintExample);
    const out = join(dir, 'scaled.text.png');
    await captureTextPlateFrame(session, context, threeWithText, lookBibleExample, { fps: 30, width: 96, height: 54 }, 2, out);
    assert.ok(existsSync(out));
    assert.ok(existsSync(join(dir, 'page-scaled', 'index.html')));
    assert.match(readFileSync(join(dir, 'page-scaled', 'index.html'), 'utf8'), /96x54/);
    assert.deepEqual(renderer.capturedFrames, [2]);
    assert.equal(renderer.requests[0]?.spec.plate, 'text');
  });
});
