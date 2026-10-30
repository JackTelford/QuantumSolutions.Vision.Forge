import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAssemblyPlan, defaultMusicGainDb, deliveryExtension, deliveryLoudness, planAudio, planCaptions, planTransitions } from '../../src/assemble/plan-from-job.ts';
import type { AssemblyPlanInputs } from '../../src/assemble/plan-from-job.ts';
import { ShotNotRenderedError } from '../../src/errors/job-errors.ts';
import { SchemaValidationError } from '../../src/errors/vision-forge-error.ts';
import { runSemanticChecks } from '../../src/schema/checks/index.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { Codec } from '../../src/shared/contracts/assembly-plan.ts';
import type { Job, JobShot } from '../../src/shared/contracts/job.ts';
import type { RenderManifest } from '../../src/shared/contracts/render-manifest.ts';
import { planLook, planShotSpec } from '../plan/fixtures.ts';
import { fingerprintExample } from '../render/fixtures.ts';
import { hex64, jobExample, mutated } from '../schema/documents/examples.ts';

const jobDir = 'C:/vf/out/k7f2q9x1';
const keys: Readonly<Record<string, string>> = { s01: hex64('a'), s02: hex64('b'), s03: hex64('c') };
const textKey = hex64('d');

function manifestPathOf(key: string): string {
  return `C:/vf/cache/${key}/manifest.json`;
}

/** A manifest of the shot under the key: complete with every frame hashed, or rendering with half of them; a text plate's manifest says so. */
function manifestOf(shotId: string, key: string, frameCount: number, status: 'complete' | 'rendering' = 'complete', plate?: 'picture' | 'text'): RenderManifest {
  const hashed = status === 'complete' ? frameCount : Math.floor(frameCount / 2);
  return {
    kind: 'render-manifest',
    version: 1,
    shotId,
    key,
    lane: 'html',
    ...(plate === undefined ? {} : { plate }),
    renderProfile: { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' },
    fingerprint: fingerprintExample,
    fps: 30,
    width: 1920,
    height: 1080,
    frameCount,
    frames: Array.from({ length: hashed }, (_, index) => ({ index, sha256: hex64('e') })),
    status,
    startedAt: '2026-10-29T10:00:00.000Z',
    toolVersionsHash: hex64('f'),
  };
}

/** The job as render leaves it: every shot rendered under its key with a manifest in its cache. */
const renderedJob: Job = mutated(jobExample, (copy) => {
  copy.status = 'rendering';
  copy.outDir = jobDir;
  copy.shots = planShotSpec.shots.map((shot): JobShot => ({ id: shot.id, key: keys[shot.id] ?? '', status: 'rendered', manifestPath: manifestPathOf(keys[shot.id] ?? ''), stillPath: `${jobDir}/stills/${shot.id}-r1.png`, rounds: 1 }));
});

/** The manifests on disk, keyed by path; a path outside the map is an unexpected read. */
function manifestsOf(entries: readonly RenderManifest[]): (path: string) => RenderManifest {
  const byPath = new Map(entries.map((manifest) => [manifestPathOf(manifest.key), manifest] as const));
  return (path: string): RenderManifest => {
    const manifest = byPath.get(path);
    if (manifest === undefined) throw new Error(`unexpected manifest read: ${path}`);
    return manifest;
  };
}

const completeManifests = planShotSpec.shots.map((shot) => manifestOf(shot.id, keys[shot.id] ?? '', shot.durationFrames));

function baseInputs(overrides: Partial<AssemblyPlanInputs> = {}): AssemblyPlanInputs {
  return {
    job: renderedJob,
    shotSpec: planShotSpec,
    look: planLook,
    narration: null,
    music: null,
    burnIn: false,
    cubePath: `${jobDir}/grade.cube`,
    outputPath: `${jobDir}/k7f2q9x1.mp4`,
    codec: 'h264',
    readManifest: manifestsOf(completeManifests),
    ...overrides,
  };
}

/** The inputs of a plan over the fixture as rendered, with overrides. */
function inputs(overrides: Partial<AssemblyPlanInputs> = {}): AssemblyPlanInputs {
  return baseInputs(overrides);
}

const narration = { wavPath: `${jobDir}/narration/narration.wav`, srtPath: `${jobDir}/narration/captions.srt` };

function notRendered(shotId: string, pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof ShotNotRenderedError && error.code === 'shot-not-rendered' && error.shotId === shotId && pattern.test(error.message) && /Run render first/.test(error.hint);
}

describe('buildAssemblyPlan', () => {
  it('builds one clip per shot in shot-spec order from each shot\'s cache, numbered from 0, as long as the shot', () => {
    const plan = buildAssemblyPlan(inputs());
    assert.deepEqual([plan.fps, plan.width, plan.height], [30, 1920, 1080]);
    assert.deepEqual(plan.clips.map((clip) => clip.id), ['s01', 's02', 's03']);
    assert.deepEqual(plan.clips.map((clip) => clip.durationFrames), [105, 90, 120]);
    assert.deepEqual(plan.clips[0]?.source, { kind: 'frames', path: `C:/vf/cache/${keys['s01']}/frames/f%06d.png`, startNumber: 0 });
    validateDocument('assembly-plan', plan);
    assert.deepEqual(runSemanticChecks('assembly-plan', plan, { dataDir: undefined }), []);
  });

  it('copies the dissolve from the shot spec as a transition and omits the cut', () => {
    assert.deepEqual(planTransitions(planShotSpec), [{ afterClipId: 's01', type: 'dissolve', frames: 15 }]);
    assert.deepEqual(buildAssemblyPlan(inputs()).transitions, [{ afterClipId: 's01', type: 'dissolve', frames: 15 }]);
  });

  it('refuses a shot that is not rendered yet with shot-not-rendered, naming the shot and the render command', () => {
    const pending = mutated(renderedJob, (copy) => { copy.shots[1] = { ...copy.shots[1]!, status: 'still-approved', manifestPath: null }; });
    assert.throws(() => buildAssemblyPlan(inputs({ job: pending })), notRendered('s02', /its status is still-approved/));
  });

  it('refuses a shot whose manifest is incomplete, or rendered under another key than the job records', () => {
    const partial = completeManifests.map((manifest) => (manifest.shotId === 's03' ? manifestOf('s03', keys['s03'] ?? '', 120, 'rendering') : manifest));
    assert.throws(() => buildAssemblyPlan(inputs({ readManifest: manifestsOf(partial) })), notRendered('s03', /is rendering with 60 of 120 frames/));
    const rekeyed = mutated(renderedJob, (copy) => { copy.shots[0] = { ...copy.shots[0]!, key: hex64('9') }; });
    assert.throws(() => buildAssemblyPlan(inputs({ job: rekeyed })), notRendered('s01', /another key/));
  });

  it('leaves the overlay null for a shot without a text plate and names the plate\'s frames when the job records one for a shot with text', () => {
    const plain = buildAssemblyPlan(inputs());
    assert.deepEqual(plain.clips.map((clip) => clip.overlay), [null, null, null]);
    const withPlate = mutated(renderedJob, (copy) => { copy.shots[0] = { ...copy.shots[0]!, textKey, textManifestPath: manifestPathOf(textKey) }; });
    const titledFirstShot = mutated(planShotSpec, (copy) => { copy.shots[0]!.text = [...copy.shots[2]!.text]; });
    const manifests = manifestsOf([...completeManifests, manifestOf('s01', textKey, 105, 'complete', 'text')]);
    const plan = buildAssemblyPlan(inputs({ job: withPlate, shotSpec: titledFirstShot, readManifest: manifests }));
    assert.deepEqual(plan.clips[0]?.overlay, { kind: 'frames', path: `C:/vf/cache/${textKey}/frames/f%06d.png`, startNumber: 0 });
    assert.equal(plan.clips[1]?.overlay, null);
    validateDocument('assembly-plan', plan);
    // A job entry that still records a plate for a shot that has no text (the text was removed after a render) is ignored, not composited.
    const stale = buildAssemblyPlan(inputs({ job: withPlate, readManifest: manifests }));
    assert.equal(stale.clips[0]?.overlay, null);
  });

  it('refuses, through the semantic checks, a text plate whose path is not a printf pattern', () => {
    const plan = buildAssemblyPlan(inputs());
    const broken = { ...plan, clips: plan.clips.map((clip, index) => (index === 0 ? { ...clip, overlay: { kind: 'frames' as const, path: 'C:/vf/cache/t/frames/f000000.png', startNumber: 0 } } : clip)) };
    assert.deepEqual(runSemanticChecks('assembly-plan', broken, { dataDir: undefined }), ['clip "s01" has a text plate without a printf pattern such as f%06d.png']);
  });

  it('refuses a text plate whose manifest is incomplete, rendered under another key than the job records, or not a text plate at all', () => {
    const withPlate = mutated(renderedJob, (copy) => { copy.shots[0] = { ...copy.shots[0]!, textKey, textManifestPath: manifestPathOf(textKey) }; });
    const titled = mutated(planShotSpec, (copy) => { copy.shots[0]!.text = [...copy.shots[2]!.text]; });
    const inputs = (overrides: Partial<AssemblyPlanInputs>): AssemblyPlanInputs => baseInputs({ shotSpec: titled, ...overrides });
    const partial = manifestsOf([...completeManifests, manifestOf('s01', textKey, 105, 'rendering', 'text')]);
    assert.throws(() => buildAssemblyPlan(inputs({ job: withPlate, readManifest: partial })), notRendered('s01', /text plate manifest .* is rendering with 52 of 105 frames/));
    // The job's textKey is newer than the plate in the cache: still or render re-keyed the plate and the cache was not rendered again.
    const rekeyed = mutated(withPlate, (copy) => { copy.shots[0] = { ...copy.shots[0]!, textKey: hex64('9') }; });
    assert.throws(() => buildAssemblyPlan(inputs({ job: rekeyed, readManifest: manifestsOf([...completeManifests, manifestOf('s01', textKey, 105, 'complete', 'text')]) })), notRendered('s01', /text plate .* another key/));
    // A picture cache named as the plate would be laid over the picture whole.
    const picture = manifestsOf([...completeManifests, manifestOf('s01', textKey, 105, 'complete', 'picture')]);
    assert.throws(() => buildAssemblyPlan(inputs({ job: withPlate, readManifest: picture })), notRendered('s01', /is not a text plate/));
    const unmarked = manifestsOf([...completeManifests, manifestOf('s01', textKey, 105)]);
    assert.throws(() => buildAssemblyPlan(inputs({ job: withPlate, readManifest: unmarked })), notRendered('s01', /is not a text plate/));
  });

  it('places the narration as one line at frame 0 at -16 LUFS and -1.5 dBTP, with its captions as a sidecar unless burn-in is asked', () => {
    const plan = buildAssemblyPlan(inputs({ narration }));
    assert.deepEqual(plan.audio, { narration: [{ path: narration.wavPath, startFrame: 0 }], music: null, loudnessLufs: -16, truePeakDbtp: -1.5 });
    const style = { fontFamily: planLook.typography.body, textColor: planLook.palette.text, scrimColor: planLook.palette.background, scrimOpacity: 0.6, fontSizePx: 36, marginBottomPx: 72 };
    assert.deepEqual(plan.captions, { srtPath: narration.srtPath, burnIn: false, style });
    assert.deepEqual(buildAssemblyPlan(inputs({ narration, burnIn: true })).captions, { srtPath: narration.srtPath, burnIn: true, style });
    assert.deepEqual(deliveryLoudness, { lufs: -16, truePeakDbtp: -1.5 });
  });

  it('ducks the music under the narration and leaves it alone without one, at the given gain', () => {
    const music = { path: 'C:/music/bed.wav', gainDb: -18 };
    assert.deepEqual(planAudio(narration, music)?.music, { path: music.path, duckUnderNarration: true, gainDb: -18 });
    assert.deepEqual(planAudio(null, music), { narration: [], music: { path: music.path, duckUnderNarration: false, gainDb: -18 }, loudnessLufs: -16, truePeakDbtp: -1.5 });
    assert.equal(defaultMusicGainDb, -12);
    const plan = buildAssemblyPlan(inputs({ music }));
    assert.equal(plan.audio?.music?.duckUnderNarration, false);
    assert.equal(plan.captions, undefined);
  });

  it('has neither audio nor captions for a silent piece', () => {
    assert.equal(planAudio(null, null), undefined);
    assert.equal(planCaptions(null, true, planLook, 1080), undefined);
    const plan = buildAssemblyPlan(inputs());
    assert.equal(plan.audio, undefined);
    assert.equal(plan.captions, undefined);
  });

  it('names the delivery .mp4 for h264 and hevc and .mov for prores, at CRF 16, medium, faststart', () => {
    assert.deepEqual((['h264', 'hevc', 'prores'] as const).map(deliveryExtension), ['.mp4', '.mp4', '.mov']);
    const output = (codec: Codec): unknown => buildAssemblyPlan(inputs({ codec, outputPath: `${jobDir}/k7f2q9x1${deliveryExtension(codec)}` })).output;
    assert.deepEqual(output('h264'), { path: `${jobDir}/k7f2q9x1.mp4`, codec: 'h264', crf: 16, preset: 'medium', faststart: true });
    assert.deepEqual(output('hevc'), { path: `${jobDir}/k7f2q9x1.mp4`, codec: 'hevc', crf: 16, preset: 'medium', faststart: true });
    assert.deepEqual(output('prores'), { path: `${jobDir}/k7f2q9x1.mov`, codec: 'prores', crf: 16, preset: 'medium', faststart: true });
  });

  it('takes the grade from the look with the cube the caller names', () => {
    const { vignetteAmount, vignetteSoftness, grainAmount, grainSeed } = planLook.grade;
    assert.deepEqual(buildAssemblyPlan(inputs()).grade, { cubePath: `${jobDir}/grade.cube`, vignetteAmount, vignetteSoftness, grainAmount, grainSeed });
  });

  it('rejects a delivery path whose extension disagrees with the codec, as the semantic checks do', () => {
    assert.throws(() => buildAssemblyPlan(inputs({ codec: 'prores' })), (error: unknown) => error instanceof SchemaValidationError && error.problems.some((problem) => /\.mov/.test(problem)));
  });
});
