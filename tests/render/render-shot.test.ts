import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { ProcessResult, ProcessRunner, ProcessSpec } from '../../src/process/process-runner.ts';
import { framePath, manifestPath, shotCacheDir } from '../../src/render/cache.ts';
import { complete, newManifest, readManifest } from '../../src/render/manifest.ts';
import { manifestBatchSize, median, renderShot, revertToRendering } from '../../src/render/render-shot.ts';
import type { RenderShotInputs } from '../../src/render/render-shot.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import { sha256Hex } from '../../src/shared/sha256.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeBrowserRenderer } from '../fakes/fake-browser-renderer.ts';
import { hex64, lookBibleExample, shotExample } from '../schema/documents/examples.ts';
import { fakePage, fingerprintExample, manifestInputs, smallSpec } from './fixtures.ts';

const never = new AbortController().signal;
const ffmpeg = findFfmpeg();

/** Answers every framehash run with one hash per requested frame, computed from the frame number, and records the runs. */
class ScriptedFramehashRunner implements ProcessRunner {
  readonly invocations: ProcessSpec[] = [];

  async run(spec: ProcessSpec, _signal: AbortSignal): Promise<ProcessResult> {
    this.invocations.push(spec);
    const first = Number(spec.args[spec.args.indexOf('-start_number') + 1]);
    const count = Number(spec.args[spec.args.indexOf('-frames:v') + 1]);
    const lines = ['#format: frame checksums', '#stream#, dts,        pts, duration,     size, hash'];
    for (let pts = 0; pts < count; pts += 1) lines.push(`0, ${pts}, ${pts}, 1, 384, ${await sha256Hex(`frame-${first + pts}`)}`);
    return { exitCode: 0, signal: null, stdout: `${lines.join('\n')}\n`, stderr: '', elapsedMs: 1, timedOut: false };
  }
}

/** Rejects the first framehash run as ffmpeg would when it is broken, then behaves like the scripted runner. */
class FailingOnceFramehashRunner extends ScriptedFramehashRunner {
  rejected = false;

  override run(spec: ProcessSpec, signal: AbortSignal): Promise<ProcessResult> {
    if (!this.rejected) {
      this.rejected = true;
      return Promise.reject(new Error('ffmpeg framehash broke'));
    }
    return super.run(spec, signal);
  }
}

let clock = 0;
const now = (): Date => { clock += 10; return new Date(Date.UTC(2026, 9, 29, 10, 0, 0, clock)); };

describe('renderShot with a fake browser and a scripted ffmpeg', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-render-shot-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  function inputs(renderer: FakeBrowserRenderer, runner: ProcessRunner, frames: readonly number[], changes: Partial<RenderShotInputs> = {}): RenderShotInputs {
    const key = changes.key ?? hex64('c');
    return {
      renderer, page: fakePage, harnessUrl: 'http://127.0.0.1:5123', pageDir: join(dir, 'page'), shot: shotExample('s03', 5, 'html'), look: lookBibleExample, spec: smallSpec, frames,
      cacheDir: shotCacheDir(dir, key), key, fingerprint: fingerprintExample, runner, ffmpegPath: 'C:\\tools\\ffmpeg.exe', log: new MemoryLogger(), signal: never, now, ...changes,
    };
  }

  it('captures every frame, hashes it and writes a complete, valid manifest', async () => {
    const renderer = new FakeBrowserRenderer();
    const runner = new ScriptedFramehashRunner();
    const result = await renderShot(inputs(renderer, runner, [0, 1, 2, 3, 4]));
    assert.equal(result.frames, 5);
    assert.equal(result.reused, 0);
    assert.ok(result.elapsedMs > 0);
    assert.ok(result.msPerFrame > 0);
    assert.ok(result.screenshotMsMedian >= 1);
    assert.equal(result.manifestPath, manifestPath(shotCacheDir(dir, hex64('c'))));
    assert.equal(result.framePattern, `${result.framesDir.replace(/\\/g, '/')}/f%06d.png`);
    for (const frame of [0, 1, 2, 3, 4]) assert.ok(existsSync(framePath(result.framesDir, frame)), `frame ${frame}`);
    const manifest = readManifest(result.manifestPath);
    validateDocument('render-manifest', manifest);
    assert.equal(manifest.status, 'complete');
    assert.deepEqual(manifest.frames.map((entry) => entry.index), [0, 1, 2, 3, 4]);
    assert.equal(manifest.frames[3]?.sha256, await sha256Hex('frame-3'));
    assert.equal(manifest.shotId, 's03');
    assert.equal(manifest.frameCount, 5);
    assert.deepEqual(manifest.renderProfile, renderer.profile);
    assert.equal(renderer.requests.length, 1);
    assert.equal(renderer.requests[0]?.pageUrl, 'http://127.0.0.1:5123/page/index.html');
    assert.equal(renderer.requests[0]?.spec.camera.length, 5);
    assert.ok(existsSync(join(dir, 'page', 'index.html')));
  });

  it('resumes: a second run reuses every hashed frame and captures nothing, a deleted PNG is captured again', async () => {
    const renderer = new FakeBrowserRenderer();
    const runner = new ScriptedFramehashRunner();
    const path = manifestPath(shotCacheDir(dir, hex64('c')));
    const before = readManifest(path);
    const again = await renderShot(inputs(renderer, runner, [0, 1, 2, 3, 4]));
    assert.equal(again.reused, 5);
    assert.equal(again.msPerFrame, 0);
    assert.equal(renderer.requests.length, 0);
    assert.equal(runner.invocations.length, 0);
    assert.deepEqual(readManifest(path), before, 'a finished shot with nothing to capture is not rewritten; its finishedAt stays');
    rmSync(framePath(again.framesDir, 2));
    const repaired = await renderShot(inputs(renderer, runner, [0, 1, 2, 3, 4]));
    assert.equal(repaired.reused, 4);
    assert.deepEqual(renderer.capturedFrames, [2]);
    assert.equal(readManifest(repaired.manifestPath).status, 'complete');
  });

  it('leaves a partial render in the rendering state and completes it on the next run', async () => {
    const key = hex64('d');
    const first = await renderShot(inputs(new FakeBrowserRenderer(), new ScriptedFramehashRunner(), [0, 1, 2], { key }));
    assert.equal(readManifest(first.manifestPath).status, 'rendering');
    assert.equal(readManifest(first.manifestPath).frames.length, 3);
    const renderer = new FakeBrowserRenderer();
    const second = await renderShot(inputs(renderer, new ScriptedFramehashRunner(), [0, 1, 2, 3, 4], { key }));
    assert.equal(second.reused, 3);
    assert.deepEqual(renderer.capturedFrames, [3, 4]);
    assert.equal(readManifest(second.manifestPath).status, 'complete');
  });

  it('starts afresh when the fingerprint changed, even though the frames are on disk', async () => {
    const renderer = new FakeBrowserRenderer();
    const log = new MemoryLogger();
    const result = await renderShot(inputs(renderer, new ScriptedFramehashRunner(), [0, 1, 2, 3, 4], { fingerprint: { ...fingerprintExample, node: 'v26.0.0' }, log }));
    assert.equal(result.reused, 0);
    assert.equal(renderer.capturedFrames.length, 5);
    assert.ok(log.messages.some((message) => /another key or fingerprint/.test(message)), log.messages.join('\n'));
    assert.equal(readManifest(result.manifestPath).fingerprint.node, 'v26.0.0');
  });

  it('records the frames in batches of thirty while the browser captures', async () => {
    const runner = new ScriptedFramehashRunner();
    const frames = Array.from({ length: 65 }, (_, frame) => frame);
    const result = await renderShot(inputs(new FakeBrowserRenderer(), runner, frames, { key: hex64('e'), shot: shotExample('s03', 65, 'html') }));
    assert.deepEqual(runner.invocations.map((spec) => spec.args[spec.args.indexOf('-frames:v') + 1]), ['30', '30', '5']);
    assert.equal(readManifest(result.manifestPath).frames.length, 65);
  });

  it('marks the manifest failed with the frames that landed, rethrows, and resumes from them', async () => {
    const key = hex64('f');
    const failing = new FakeBrowserRenderer({ failAfterFrames: 2 });
    await assert.rejects(renderShot(inputs(failing, new ScriptedFramehashRunner(), [0, 1, 2, 3, 4], { key })), /fake renderer failed at frame 2/);
    const path = manifestPath(shotCacheDir(dir, key));
    const failed = readManifest(path);
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.frames.map((entry) => entry.index), [0, 1]);
    assert.ok(failed.finishedAt !== undefined);
    const renderer = new FakeBrowserRenderer();
    const resumed = await renderShot(inputs(renderer, new ScriptedFramehashRunner(), [0, 1, 2, 3, 4], { key }));
    assert.equal(resumed.reused, 2);
    assert.deepEqual(renderer.capturedFrames, [2, 3, 4]);
    assert.equal(readManifest(path).status, 'complete');
  });

  it('stops the capture soon after a hash batch fails instead of rendering the whole shot, marks the manifest failed and rethrows', async () => {
    const key = hex64('1');
    const frames = Array.from({ length: 3 * manifestBatchSize }, (_, frame) => frame);
    const shot = shotExample('s03', frames.length, 'html');
    const renderer = new FakeBrowserRenderer();
    const runner = new FailingOnceFramehashRunner();
    await assert.rejects(renderShot(inputs(renderer, runner, frames, { key, shot })), /ffmpeg framehash broke/);
    // The first batch flushes after frame 29 and fails during the next event-loop turn, so frame 30 is the last the browser renders.
    assert.ok(renderer.landed.length <= manifestBatchSize + 1, `captured ${renderer.landed.length} frames`);
    assert.equal(renderer.capturedFrames.length, frames.length, 'every frame was asked for');
    const path = manifestPath(shotCacheDir(dir, key));
    assert.equal(readManifest(path).status, 'failed');
    assert.deepEqual(readManifest(path).frames, [], 'the failed batch recorded nothing');
    const resumed = await renderShot(inputs(new FakeBrowserRenderer(), new ScriptedFramehashRunner(), frames, { key, shot }));
    assert.equal(resumed.reused, 0, 'frames on disk without a hash are captured again');
    assert.equal(readManifest(path).status, 'complete');
  });

  it('drops finishedAt when a finished or failed manifest goes back to rendering', async () => {
    const done = complete(await newManifest(manifestInputs()), '2026-10-29T10:01:00.000Z');
    const reverted = revertToRendering(done);
    assert.equal(reverted.status, 'rendering');
    assert.equal('finishedAt' in reverted, false);
    validateDocument('render-manifest', reverted);
  });

  it('takes the median of the screenshot times', () => {
    assert.equal(median([]), 0);
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });
});

describe('renderShot with a fake browser and the installed ffmpeg', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-render-shot-ffmpeg-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('hashes the fake frames with framehash: equal colours hash alike across two frames of one colour', async () => {
    if (ffmpeg === undefined) return;
    const shot = shotExample('s03', 3, 'html');
    const result = await renderShot({
      renderer: new FakeBrowserRenderer(), page: fakePage, harnessUrl: 'http://127.0.0.1:1', pageDir: join(dir, 'page'), shot, look: lookBibleExample, spec: smallSpec, frames: [0, 1, 2],
      cacheDir: shotCacheDir(dir, hex64('a')), key: hex64('a'), fingerprint: fingerprintExample, runner: new ChildProcessRunner(), ffmpegPath: ffmpeg.path, log: new MemoryLogger(), signal: never, now,
    });
    const manifest = readManifest(result.manifestPath);
    assert.equal(manifest.status, 'complete');
    const hashes = manifest.frames.map((entry) => entry.sha256);
    assert.equal(new Set(hashes).size, 3, 'three colours, three hashes');
    for (const hash of hashes) assert.match(hash, /^[0-9a-f]{64}$/);
  });
});
