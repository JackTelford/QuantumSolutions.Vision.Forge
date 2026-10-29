import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../../src/cli/logger.ts';
import { readJsonFile } from '../../../src/fs/atomic-json.ts';
import { ladderAttempt } from '../../../src/lanes/blender/ladder.ts';
import { blenderUserResourcesDir } from '../../../src/lanes/blender/runner.ts';
import { ChildProcessRunner } from '../../../src/process/child-process-runner.ts';
import { batchSceneDir, blenderFingerprint, realBlenderSeams, renderBlenderShot, sceneHashesPath } from '../../../src/render/blender-shot.ts';
import type { SceneHashEntry } from '../../../src/render/blender-shot.ts';
import { framePath, shotCacheDir } from '../../../src/render/cache.ts';
import { readManifest } from '../../../src/render/manifest.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import type { RenderSpec } from '../../../src/shared/camera/types.ts';
import type { BlenderScene } from '../../../src/shared/contracts/blender-scene.ts';
import { blenderVersion, findBlender, isSupportedBlenderVersion } from '../../../src/tools/blender.ts';
import { findFfmpeg } from '../../../src/tools/ffmpeg.ts';
import { ffmpegVersion } from '../../../src/tools/ffmpeg-info.ts';
import { planLook, planShotSpec } from '../../plan/fixtures.ts';
import { hex64, mutated } from '../../schema/documents/examples.ts';

const never = new AbortController().signal;
const runner = new ChildProcessRunner();
const ffmpeg = findFfmpeg();

/** The Blender doctor would accept, or undefined; the CI runners have none, so the suite self-skips there. */
async function supportedBlender(): Promise<{ readonly path: string; readonly version: string } | undefined> {
  const discovery = await findBlender(runner);
  if (discovery.found === undefined) return undefined;
  const version = await blenderVersion(runner, discovery.found.path);
  if (version === undefined || !isSupportedBlenderVersion(version)) return undefined;
  return { path: discovery.found.path, version };
}

const blender = await supportedBlender();
const skip = blender === undefined ? 'no supported Blender is installed' : ffmpeg === undefined ? 'ffmpeg is not installed' : false;

describe('the blender lane on the installed Blender', { skip }, () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-blender-real-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('renders one 64x36 Cycles CPU frame of the fixture bottle through the real applier, judged by the predicate and hashed into a manifest', { timeout: 60_000 }, async () => {
    if (blender === undefined || ffmpeg === undefined) return;
    const shot = mutated(planShotSpec.shots[1]!, (copy) => { copy.lane = 'blender'; });
    const spec: RenderSpec = { fps: planShotSpec.fps, width: 64, height: 36 };
    const attempt = ladderAttempt({ engine: 'cycles', backend: 'CPU' }, 'still', spec.width);
    const frame = 26;
    const log = new MemoryLogger();
    const dataDir = join(dir, 'data');
    const cacheDir = shotCacheDir(dataDir, hex64('5'));
    // The version the way doctor records it, so the manifest is the one render would write.
    const ffmpegVersionText = await ffmpegVersion(runner, ffmpeg.path, never);
    assert.ok(ffmpegVersionText !== undefined, 'ffmpeg -version prints a version');
    const started = Date.now();
    const result = await renderBlenderShot({
      seams: realBlenderSeams, shot, look: planLook, spec, frames: [frame], cacheDir, key: hex64('5'), fingerprint: blenderFingerprint(blender.version, ffmpegVersionText),
      attempt, blenderPath: blender.path, dataDir, hdriPath: null, runner, ffmpegPath: ffmpeg.path, log, signal: never, now: (): Date => new Date(),
    });
    const elapsed = Date.now() - started;
    const png = framePath(result.framesDir, frame);
    assert.ok(existsSync(png), png);
    assert.ok(statSync(png).size > 100, 'a PNG with pixels in it');
    assert.deepEqual(result.profile, { engine: 'cycles', backend: 'CPU', renderer: 'software' });
    const manifest = readManifest(result.manifestPath);
    validateDocument('render-manifest', manifest);
    assert.deepEqual(manifest.frames.map((entry) => entry.index), [frame]);
    assert.equal(manifest.fingerprint.blender, blender.version);
    assert.match(manifest.fingerprint.ffmpeg, /^\d+\.\d+/, manifest.fingerprint.ffmpeg);
    assert.ok(existsSync(blenderUserResourcesDir(dataDir)));
    const sceneDir = batchSceneDir(cacheDir, 'cycles-CPU', frame, frame);
    const scene = readJsonFile(join(sceneDir, 'scene.json')) as BlenderScene;
    validateDocument('blender-scene', scene);
    assert.equal(scene.render.engine, 'CYCLES');
    assert.equal(scene.render.cycles.device, 'CPU');
    assert.equal(scene.render.cycles.useDenoising, true, 'a still is denoised');
    assert.equal(scene.output.frameStart, frame);
    const hashes = readJsonFile(sceneHashesPath(cacheDir)) as { readonly batches: readonly SceneHashEntry[] };
    assert.equal(hashes.batches.length, 1);
    assert.ok(existsSync(join(sceneDir, 'blender-stdout.log')), 'Blender\'s output is kept beside the scene');
    const stdout = readFileSync(join(sceneDir, 'blender-stdout.log'), 'utf8');
    assert.match(stdout, /Saved: /, 'Blender reports the saved frame');
    const exitLine = log.messages.find((message) => /blender cycles-CPU: frames 26-26/.test(message)) ?? '';
    assert.match(exitLine, /exit (0|3221225477)/, `the run ended with exit 0 or the documented teardown crash: ${exitLine}`);
    // The whole render, Blender's start included, stays well inside the one-minute budget this test has; the number is evidence for docs/evidence/m5.
    assert.ok(elapsed < 55_000, `${elapsed} ms`);
    log.info(`real Blender ${blender.version}: ${elapsed} ms for one 64x36 Cycles CPU frame at ${attempt.attempt.samples} samples (${exitLine})`);
  });
});
