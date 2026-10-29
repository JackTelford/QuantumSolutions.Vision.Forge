import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { BlenderRenderError, BlenderScriptError, BlenderTimeoutError } from '../../src/errors/blender-errors.ts';
import { ToolMissingError, ToolVersionError } from '../../src/errors/vision-forge-error.ts';
import { readJsonFile } from '../../src/fs/atomic-json.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import { ladderAttempt } from '../../src/lanes/blender/ladder.ts';
import { writeSceneDocument } from '../../src/lanes/blender/scene-file.ts';
import { AssetLedger, assetLedgerPath } from '../../src/net/asset-ledger.ts';
import { blenderHdriPath } from '../../src/render/environment.ts';
import { batchSceneDir, blenderDeviceTypes, blenderFingerprint, readBlenderTools, realBlenderSeams, recordSceneHash, renderBlenderShot, sceneHashesPath } from '../../src/render/blender-shot.ts';
import type { BlenderBatchSceneInputs, BlenderSceneSeams, BlenderShotInputs, SceneHashEntry } from '../../src/render/blender-shot.ts';
import { framePath, manifestPath, shotCacheDir } from '../../src/render/cache.ts';
import { readManifest } from '../../src/render/manifest.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import { toBlenderQuaternion, toBlenderVector } from '../../src/shared/camera/blender-axes.ts';
import type { BlenderScene } from '../../src/shared/contracts/blender-scene.ts';
import { blenderCommand } from '../../src/tools/blender.ts';
import { writeToolsManifest } from '../../src/tools/tools-manifest.ts';
import { FakeBlenderRunner } from '../fakes/fake-blender-runner.ts';
import { hex64, lookBibleExample, mutated, shotExample } from '../schema/documents/examples.ts';
import { smallSpec, toolsManifestExample } from './fixtures.ts';

const never = new AbortController().signal;
let clock = 0;
const now = (): Date => { clock += 10; return new Date(Date.UTC(2026, 9, 29, 12, 0, 0, clock)); };
const cyclesCpu = ladderAttempt({ engine: 'cycles', backend: 'CPU' }, 'render', smallSpec.width);
const eeveeOpengl = ladderAttempt({ engine: 'eevee', backend: 'opengl' }, 'still', smallSpec.width);
const blenderShot = shotExample('s02', 40, 'blender');

/** A hand-written scene document with nothing in it but the camera: enough for the applier's schema and for a fake Blender that reads the frame range; denoising follows the purpose, as the resolver's does. */
function bareScene(inputs: BlenderBatchSceneInputs): BlenderScene {
  return {
    kind: 'blender-scene',
    version: 1,
    shotId: inputs.shot.id,
    output: { directory: inputs.framesDirectory.replace(/\\/g, '/'), fileStem: `${inputs.outputStem}######`, frameStart: inputs.frames[0] ?? 0, frameEnd: inputs.frames[inputs.frames.length - 1] ?? 0, fps: inputs.spec.fps, width: inputs.spec.width, height: inputs.spec.height, colorDepth: '8' },
    render: {
      engine: inputs.attempt.engine === 'eevee' ? 'BLENDER_EEVEE' : 'CYCLES',
      eeveeSamples: 64,
      cycles: { samples: inputs.attempt.samples, useDenoising: inputs.still, denoiser: 'OPENIMAGEDENOISE', device: 'CPU', computeDeviceType: 'NONE', deviceTypes: ['CPU'] },
      motionBlur: { enabled: true, shutter: 0.5 },
    },
    colorManagement: { viewTransform: 'AgX', exposure: -0.3 },
    world: { color: { r: 0.01, g: 0.01, b: 0.02 }, strength: 0.2, hdriPath: inputs.hdriPath, hdriStrength: 1, hdriRotationZRad: 0 },
    camera: {
      sensorWidthMm: 36, clipStartM: 0.02, clipEndM: 100, useDof: true,
      keyframes: inputs.frames.map((frame) => {
        const baked = inputs.camera[frame];
        if (baked === undefined) throw new Error(`no baked frame ${frame}`);
        const q = toBlenderQuaternion(baked.rotation);
        return { frame, location: toBlenderVector(baked.position), rotationQuaternion: { w: q.w, x: q.x, y: q.y, z: q.z }, lensMm: baked.focalMm, fStop: baked.fStop, focusDistanceM: baked.focusDistanceM };
      }),
    },
    materials: [],
    empties: [],
    objects: [],
    lights: [],
  };
}

/** Seams that hand Blender the bare scene and record every resolver call. */
class FakeSeams implements BlenderSceneSeams {
  readonly calls: BlenderBatchSceneInputs[] = [];

  resolveScene(inputs: BlenderBatchSceneInputs): BlenderScene {
    this.calls.push(inputs);
    return bareScene(inputs);
  }

  writeSceneDocument(dir: string, scene: BlenderScene): ReturnType<typeof writeSceneDocument> {
    return writeSceneDocument(dir, scene);
  }
}

describe('renderBlenderShot with a fake Blender and a scripted ffmpeg', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-blender-shot-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  function inputs(runner: FakeBlenderRunner, frames: readonly number[], changes: Partial<BlenderShotInputs> = {}): BlenderShotInputs {
    const key = changes.key ?? hex64('b');
    return {
      seams: new FakeSeams(), shot: blenderShot, look: lookBibleExample, spec: smallSpec, frames, cacheDir: shotCacheDir(dir, key), key,
      fingerprint: blenderFingerprint('5.2.3', '9.0.2'), attempt: cyclesCpu, blenderPath: 'C:\\Blender\\blender.exe', dataDir: join(dir, 'data'), hdriPath: null,
      runner, ffmpegPath: 'C:\\tools\\ffmpeg.exe', log: new MemoryLogger(), signal: never, now, crashLogPath: join(dir, 'no-crash.txt'), ...changes,
    };
  }

  it('renders every frame in batches of three then thirty, hashes them and writes a complete, valid manifest with the Blender fingerprint', async () => {
    const runner = new FakeBlenderRunner();
    const seams = new FakeSeams();
    const frames = Array.from({ length: 40 }, (_, frame) => frame);
    const result = await renderBlenderShot(inputs(runner, frames, { seams }));
    assert.equal(result.frames, 40);
    assert.equal(result.reused, 0);
    assert.ok(result.msPerFrame > 0);
    assert.equal(result.screenshotMsMedian, 0);
    assert.deepEqual(result.profile, { engine: 'cycles', backend: 'CPU', renderer: 'software' });
    assert.ok(result.estimate !== null && result.estimate.secondsPerFrame >= 0, 'the first batch was timed');
    assert.deepEqual(seams.calls.map((call) => [call.frames[0], call.frames.length]), [[0, 3], [3, 30], [33, 7]]);
    assert.equal(seams.calls[0]?.camera.length, 40, 'the whole bake goes to the resolver');
    assert.equal(seams.calls[0]?.outputStem, 'f');
    assert.deepEqual(seams.calls[0]?.attempt, cyclesCpu.attempt);
    assert.equal(runner.blenderRuns.length, 3);
    const run = runner.blenderRuns[0];
    assert.ok(run !== undefined);
    assert.equal(run.cwd, result.framesDir);
    assert.ok(!run.args.includes('--gpu-backend'), 'a Cycles attempt names no GPU backend');
    const cacheDir = shotCacheDir(dir, hex64('b'));
    assert.equal(run.args[run.args.indexOf('--') + 1], join(batchSceneDir(cacheDir, 'cycles-CPU', 0, 2), 'scene.json'));
    assert.equal(run.args[run.args.length - 1], result.framesDir.replace(/\\/g, '/'));
    assert.equal(run.stdoutFile, join(batchSceneDir(cacheDir, 'cycles-CPU', 0, 2), 'blender-stdout.log'), 'Blender\'s output is mirrored beside the batch\'s scene document');
    assert.equal(runner.blenderRuns[1]?.stderrFile, join(batchSceneDir(cacheDir, 'cycles-CPU', 3, 32), 'blender-stderr.log'));
    assert.equal(run.timeoutMs, Math.round((60 + 3 * 300 * ((480 * 270) / (1920 * 1080))) * 1000), 'the CPU rung gets the long per-frame allowance');
    for (const frame of frames) assert.ok(existsSync(framePath(result.framesDir, frame)), `frame ${frame}`);
    const manifest = readManifest(result.manifestPath);
    validateDocument('render-manifest', manifest);
    assert.equal(manifest.status, 'complete');
    assert.equal(manifest.lane, 'blender');
    assert.equal(manifest.frames.length, 40);
    assert.deepEqual(manifest.renderProfile, result.profile);
    assert.deepEqual(Object.keys(manifest.fingerprint).sort(), ['blender', 'ffmpeg', 'node']);
    assert.equal(manifest.fingerprint.blender, '5.2.3');
    const hashes = readJsonFile(sceneHashesPath(cacheDir)) as { readonly batches: readonly SceneHashEntry[] };
    assert.deepEqual(hashes.batches.map((entry) => [entry.attempt, entry.first, entry.last]), [['cycles-CPU', 0, 2], ['cycles-CPU', 3, 32], ['cycles-CPU', 33, 39]]);
    for (const entry of hashes.batches) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.equal(entry.path, join(batchSceneDir(cacheDir, 'cycles-CPU', entry.first, entry.last), 'scene.json'), 'every batch keeps its own document, so the recorded hash is of the file at the recorded path');
      assert.ok(existsSync(entry.path), entry.path);
    }
  });

  it('passes the purpose, not the batch length, to the resolver: no batch of a clip is a still, a one-frame still is', async () => {
    const clip = new FakeSeams();
    await renderBlenderShot(inputs(new FakeBlenderRunner(), [0, 1, 2, 3], { key: hex64('6'), seams: clip }));
    assert.deepEqual(clip.calls.map((call) => [call.frames.length, call.still]), [[3, false], [1, false]], 'the one-frame tail batch of a clip is not denoised');
    for (const entry of (readJsonFile(sceneHashesPath(shotCacheDir(dir, hex64('6')))) as { readonly batches: readonly SceneHashEntry[] }).batches) {
      assert.equal((readJsonFile(entry.path) as BlenderScene).render.cycles.useDenoising, false, entry.path);
    }
    const still = new FakeSeams();
    await renderBlenderShot(inputs(new FakeBlenderRunner(), [26], { key: hex64('7'), seams: still, attempt: ladderAttempt({ engine: 'cycles', backend: 'CPU' }, 'still', smallSpec.width) }));
    assert.deepEqual(still.calls.map((call) => [call.frames.length, call.still]), [[1, true]]);
  });

  it('resumes: a second run reuses every hashed frame and runs no Blender, a deleted PNG is rendered again alone', async () => {
    const runner = new FakeBlenderRunner();
    const frames = Array.from({ length: 40 }, (_, frame) => frame);
    const path = manifestPath(shotCacheDir(dir, hex64('b')));
    const before = readManifest(path);
    const again = await renderBlenderShot(inputs(runner, frames));
    assert.equal(again.reused, 40);
    assert.equal(again.msPerFrame, 0);
    assert.equal(again.estimate, null);
    assert.equal(runner.invocations.length, 0);
    assert.deepEqual(readManifest(path), before, 'a finished shot with nothing to render is not rewritten');
    rmSync(framePath(again.framesDir, 7));
    const repaired = await renderBlenderShot(inputs(runner, frames));
    assert.equal(repaired.reused, 39);
    assert.equal(runner.blenderRuns.length, 1);
    assert.equal(readManifest(path).status, 'complete');
  });

  it('starts afresh when the fingerprint changed (another Blender), even though the frames are on disk', async () => {
    const runner = new FakeBlenderRunner();
    const log = new MemoryLogger();
    const result = await renderBlenderShot(inputs(runner, [0, 1, 2], { fingerprint: blenderFingerprint('5.2.4', '9.0.2'), log }));
    assert.equal(result.reused, 0);
    assert.ok(log.messages.some((message) => /another key or fingerprint/.test(message)), log.messages.join('\n'));
    assert.equal(readManifest(result.manifestPath).fingerprint.blender, '5.2.4');
    const hashes = readJsonFile(sceneHashesPath(shotCacheDir(dir, hex64('b')))) as { readonly batches: readonly SceneHashEntry[] };
    assert.deepEqual(hashes.batches.map((entry) => [entry.first, entry.last]), [[0, 2]], 'the sidecar starts afresh with the manifest; the old Blender\'s batches are gone');
  });

  it('marks the manifest failed with the frames that landed when a batch fails, throws the predicate\'s error, and resumes from them', async () => {
    const key = hex64('c');
    const failing = new FakeBlenderRunner([{}, { exitCode: 1, writeFrames: false, stderr: 'Error: Cannot render, no camera' }]);
    const frames = Array.from({ length: 10 }, (_, frame) => frame);
    await assert.rejects(renderBlenderShot(inputs(failing, frames, { key })), (error: unknown) => error instanceof BlenderRenderError && /not written/.test(error.reason) && /no camera/.test(error.message));
    const path = manifestPath(shotCacheDir(dir, key));
    const failed = readManifest(path);
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.frames.map((entry) => entry.index), [0, 1, 2]);
    assert.ok(failed.finishedAt !== undefined);
    const runner = new FakeBlenderRunner();
    const resumed = await renderBlenderShot(inputs(runner, frames, { key }));
    assert.equal(resumed.reused, 3);
    assert.equal(runner.blenderRuns.length, 2, 'the seven remaining frames start with their own estimate batch');
    assert.equal(readManifest(path).status, 'rendering', 'ten of forty frames');
    assert.deepEqual(readManifest(path).frames.map((entry) => entry.index), frames);
  });

  it('throws blender-script on exit 3, blender-timeout on a stopped run and blender-render on a black first frame', async () => {
    await assert.rejects(renderBlenderShot(inputs(new FakeBlenderRunner([{ exitCode: 3, writeFrames: false, stderr: 'KeyError' }]), [0], { key: hex64('d') })), (error: unknown) => error instanceof BlenderScriptError && /scene\.json/.test(error.scenePath));
    await assert.rejects(renderBlenderShot(inputs(new FakeBlenderRunner([{ exitCode: null, timedOut: true }]), [0], { key: hex64('e') })), BlenderTimeoutError);
    const black = new FakeBlenderRunner();
    black.yavg = 16;
    await assert.rejects(renderBlenderShot(inputs(black, [0], { key: hex64('f') })), (error: unknown) => error instanceof BlenderRenderError && /black/.test(error.reason));
    for (const key of [hex64('d'), hex64('e'), hex64('f')]) assert.equal(readManifest(manifestPath(shotCacheDir(dir, key))).status, 'failed', key);
  });

  it('tolerates the teardown crash exit code and reads a fresh crash log as a failure', async () => {
    const crashLog = join(dir, 'blender.crash.txt');
    const crashed = await renderBlenderShot(inputs(new FakeBlenderRunner([{ exitCode: 3221225477 }]), [0], { key: hex64('1'), crashLogPath: crashLog }));
    assert.deepEqual(readManifest(crashed.manifestPath).frames.map((entry) => entry.index), [0], 'the frame counts although Blender crashed at teardown');
    const logged = new FakeBlenderRunner([{ exitCode: 3221225477, after: (): void => { writeFileSync(crashLog, 'crash', 'utf8'); } }]);
    await assert.rejects(renderBlenderShot(inputs(logged, [0], { key: hex64('2'), crashLogPath: crashLog })), (error: unknown) => error instanceof BlenderRenderError && /crash log/.test(error.reason));
  });

  it('names an EEVEE attempt\'s GPU backend and preflight in the Blender arguments and in the scene folder', async () => {
    const runner = new FakeBlenderRunner();
    const result = await renderBlenderShot(inputs(runner, [5], { key: hex64('3'), attempt: eeveeOpengl }));
    const run = runner.blenderRuns[0];
    assert.ok(run !== undefined);
    assert.deepEqual(run.args.slice(5, 11), ['--gpu-backend', 'opengl', '--python-exit-code', '3', '--python-expr', 'import gpu; gpu.init()']);
    assert.ok(existsSync(join(batchSceneDir(shotCacheDir(dir, hex64('3')), 'eevee-opengl', 5, 5), 'scene.json')));
    assert.deepEqual(result.profile, { engine: 'eevee', backend: 'opengl', renderer: 'hardware' });
    assert.deepEqual(readdirSync(result.framesDir), ['f000005.png']);
  });

  it('renders the real resolver\'s document for the fixture shot through the fake Blender', async () => {
    const runner = new FakeBlenderRunner();
    const result = await renderBlenderShot(inputs(runner, [0, 1], { key: hex64('4'), seams: realBlenderSeams, attempt: eeveeOpengl }));
    assert.equal(readManifest(result.manifestPath).status, 'rendering', 'two of forty frames');
    const scene = readJsonFile(join(batchSceneDir(shotCacheDir(dir, hex64('4')), 'eevee-opengl', 0, 1), 'scene.json')) as BlenderScene;
    validateDocument('blender-scene', scene);
    assert.equal(scene.output.frameStart, 0);
    assert.equal(scene.output.frameEnd, 1);
    assert.equal(scene.render.engine, 'BLENDER_EEVEE');
    assert.ok(scene.objects.length > 0 && scene.lights.length > 0);
  });

  it('records scene hashes in a sidecar and replaces one that does not parse', () => {
    const cacheDir = ensureDirectory(join(dir, 'sidecar'));
    writeFileSync(sceneHashesPath(cacheDir), 'not json', 'utf8');
    recordSceneHash(cacheDir, { attempt: 'cycles-CPU', first: 0, last: 2, path: 'x', sha256: hex64('a') });
    recordSceneHash(cacheDir, { attempt: 'cycles-CPU', first: 3, last: 5, path: 'y', sha256: hex64('b') });
    const parsed = readJsonFile(sceneHashesPath(cacheDir)) as { readonly kind: string; readonly batches: readonly SceneHashEntry[] };
    assert.equal(parsed.kind, 'blender-scene-hashes');
    assert.deepEqual(parsed.batches.map((entry) => entry.first), [0, 3]);
  });
});

describe('the blender lane\'s tools and environment', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-blender-tools-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads ffmpeg, Blender and the session from tools.json and lists the probe\'s device types once each', () => {
    const dataDir = join(dir, 'ok');
    const manifest = toolsManifestExample('C:\\tools\\ffmpeg.exe', []);
    writeToolsManifest(dataDir, { ...manifest, programs: { ...manifest.programs, blender: { path: 'C:\\Blender\\blender.exe', version: '5.2.3', devices: [{ name: 'RTX 2060', type: 'OPTIX' }, { name: 'RTX 2060', type: 'CUDA' }, { name: 'i7', type: 'CPU' }, { name: 'i7 again', type: 'CPU' }] } } });
    const tools = readBlenderTools(dataDir);
    assert.equal(tools.blender.version, '5.2.3');
    assert.equal(tools.ffmpeg.path, 'C:\\tools\\ffmpeg.exe');
    assert.equal(tools.interactiveSession, true);
    assert.deepEqual(blenderDeviceTypes(tools.blender), ['OPTIX', 'CUDA', 'CPU']);
    assert.deepEqual(blenderDeviceTypes({ path: 'x', version: '5.2.3' }), []);
  });

  it('asks for Blender with the install command when tools.json has none, and refuses another series', () => {
    const noBlender = join(dir, 'no-blender');
    writeToolsManifest(noBlender, toolsManifestExample('C:\\tools\\ffmpeg.exe', []));
    assert.throws(() => readBlenderTools(noBlender), (error: unknown) => error instanceof ToolMissingError && error.hint.includes(blenderCommand()));
    const old = join(dir, 'old-blender');
    const manifest = toolsManifestExample('C:\\tools\\ffmpeg.exe', []);
    writeToolsManifest(old, { ...manifest, programs: { ...manifest.programs, blender: { path: 'C:\\Old\\blender.exe', version: '4.5.15' } } });
    assert.throws(() => readBlenderTools(old), (error: unknown) => error instanceof ToolVersionError && error.found === '4.5.15');
    const noFfmpeg = join(dir, 'no-ffmpeg');
    writeToolsManifest(noFfmpeg, toolsManifestExample(undefined, []));
    assert.throws(() => readBlenderTools(noFfmpeg), (error: unknown) => error instanceof ToolMissingError && error.tool === 'ffmpeg');
  });

  it('builds a fingerprint without browser fields that a manifest accepts', () => {
    const fingerprint = blenderFingerprint('5.2.3', '9.0.2');
    assert.deepEqual(fingerprint, { node: process.version, ffmpeg: '9.0.2', blender: '5.2.3' });
  });

  it('finds the rig\'s HDRI at 2k before 1k under the data directory with forward slashes, and null when none is installed', () => {
    const dataDir = join(dir, 'assets');
    const shot = mutated(blenderShot, (copy) => { copy.lighting.preset = 'product-studio'; });
    assert.equal(blenderHdriPath(shot, dataDir), null);
    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    ledger.load();
    const file1k = join(dataDir, 'assets', 'hdri', 'studio_small_09_1k.hdr');
    ensureDirectory(join(dataDir, 'assets', 'hdri'));
    writeFileSync(file1k, Buffer.alloc(1615248));
    ledger.record({ id: 'hdri:studio_small_09-1k', source: 'https://dl.polyhaven.org/x', finalUrl: 'https://dl.polyhaven.org/x', license: 'CC0-1.0', bytes: 1615248, sha256: hex64('a'), md5: 'd5d7eb9d26d341d6aa4d11c1a54fd97c', fetchedAt: '2026-10-29T12:00:00.000Z', credit: 'c', files: ['assets/hdri/studio_small_09_1k.hdr'] });
    ledger.save();
    assert.equal(blenderHdriPath(shot, dataDir), file1k.replace(/\\/g, '/'));
    const file2k = join(dataDir, 'assets', 'hdri', 'studio_small_09_2k.hdr');
    writeFileSync(file2k, Buffer.alloc(6312947));
    ledger.record({ id: 'hdri:studio_small_09-2k', source: 'https://dl.polyhaven.org/y', finalUrl: 'https://dl.polyhaven.org/y', license: 'CC0-1.0', bytes: 6312947, sha256: hex64('b'), md5: 'b056fea247bc84b81d2e0987d44c87d8', fetchedAt: '2026-10-29T12:00:00.000Z', credit: 'c', files: ['assets/hdri/studio_small_09_2k.hdr'] });
    ledger.save();
    assert.equal(blenderHdriPath(shot, dataDir), file2k.replace(/\\/g, '/'));
  });
});
