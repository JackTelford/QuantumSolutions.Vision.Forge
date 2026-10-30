import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AssembleData } from '../../src/cli/commands/assemble.ts';
import { jobAssemblyFileNames, loadAssemblyPlan, narrationDocumentPath, parseCodec, readNarrationFiles, verifyDelivery } from '../../src/cli/commands/assemble.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { DataFileError, SchemaValidationError, UsageError } from '../../src/errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import type { AssemblyPlan } from '../../src/shared/contracts/assembly-plan.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import { findFfmpeg, findFfprobe } from '../../src/tools/ffmpeg.ts';
import { makePlan, makeSyntheticSources, never, runner } from '../assemble/support.ts';
import type { SyntheticSources } from '../assemble/support.ts';
import { renderFixtureJob, writeFixtureDocuments } from './rendered-job.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');
const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe(ffmpeg?.path);

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function cli(args: readonly string[], dataDir: string): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs: 180_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

const fakeSources: SyntheticSources = {
  dir: 'C:\\vf\\src',
  testsrcPattern: 'C:\\vf\\src\\testsrc\\f%04d.png',
  colorPattern: 'C:\\vf\\src\\color\\f%04d.png',
  largePattern: 'C:\\vf\\src\\large\\f%04d.png',
  videoPath: 'C:\\vf\\src\\rgbtest.mp4',
  anamorphicVideoPath: 'C:\\vf\\src\\rgbtest-anamorphic.mp4',
  narration: ['C:\\vf\\src\\line1.wav', 'C:\\vf\\src\\line2.wav'],
  music: 'C:\\vf\\src\\music.wav',
  srtPath: 'C:\\vf\\src\\captions.srt',
};

describe('loadAssemblyPlan', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-plan-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  function writePlan(name: string, plan: unknown): string {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(plan), 'utf8');
    return path;
  }

  it('returns a plan that passes the schema and the checks', () => {
    const plan = makePlan(fakeSources, 'C:\\vf\\out\\film.mp4');
    assert.deepEqual(loadAssemblyPlan(writePlan('good.json', plan)), plan);
  });

  it('throws DataFileError for a missing file', () => {
    assert.throws(() => loadAssemblyPlan(join(dir, 'missing.json')), DataFileError);
  });

  it('throws SchemaValidationError naming the path for a plan the schema rejects', () => {
    const bad = { ...makePlan(fakeSources, 'C:\\vf\\out\\film.mp4'), fps: 'thirty' };
    assert.throws(() => loadAssemblyPlan(writePlan('schema.json', bad)), (error: unknown) => error instanceof SchemaValidationError && error.kind === 'assembly-plan' && error.problems.some((p) => p.startsWith('/fps:')));
  });

  it('throws SchemaValidationError with the semantic problems for a plan the checks reject', () => {
    const odd = makePlan(fakeSources, 'C:\\vf\\out\\film.mp4', { width: 321 });
    assert.throws(() => loadAssemblyPlan(writePlan('odd.json', odd)), (error: unknown) => error instanceof SchemaValidationError && error.problems.some((p) => /even/.test(p)) && /odd\.json/.test(error.hint));
  });
});

describe('verifyDelivery', () => {
  const plan: AssemblyPlan = makePlan(fakeSources, 'C:\\vf\\out\\film.mp4', { transitions: [{ afterClipId: 'a', type: 'dissolve', frames: 10 }] });
  const probed = { frames: 50, fps: 30, width: 320, height: 180, pixelFormat: 'yuv420p', colorSpace: 'bt709', sampleAspectRatio: '1:1' };

  it('accepts exactly the plan length, the plan rate and size, and square pixels', () => {
    assert.deepEqual(verifyDelivery(plan, probed), []);
  });

  it('rejects a frame count off by one in either direction', () => {
    assert.deepEqual(verifyDelivery(plan, { ...probed, frames: 51 }), ['expected 50 frames, found 51']);
    assert.deepEqual(verifyDelivery(plan, { ...probed, frames: 49 }), ['expected 50 frames, found 49']);
  });

  it('names every mismatch', () => {
    const problems = verifyDelivery(plan, { ...probed, frames: 48, fps: 25, width: 640, sampleAspectRatio: '4:3' });
    assert.deepEqual(problems, ['expected 50 frames, found 48', 'expected 30 fps, found 25', 'expected 320x180, found 640x180', 'expected square pixels (SAR 1:1), found SAR 4:3']);
    assert.deepEqual(verifyDelivery(plan, { ...probed, frames: Number.NaN }), ['expected 50 frames, found NaN']);
    assert.deepEqual(verifyDelivery(plan, { ...probed, sampleAspectRatio: 'N/A' }), ['expected square pixels (SAR 1:1), found SAR N/A']);
  });
});

describe('node scripts/cli.ts assemble', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-cli-asm-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('without --plan is a usage error with exit code 2', async () => {
    const run = await cli(['assemble'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.equal(run.result.errors[0]?.code, 'usage');
    assert.match(run.result.errors[0]?.message ?? '', /Missing --plan/);
  });

  it('rejects a plan that fails the checks before running any program, with exit code 1', async () => {
    const planPath = join(dataDir, 'odd.json');
    writeFileSync(planPath, JSON.stringify(makePlan(fakeSources, join(dataDir, 'film.mp4'), { width: 321 })), 'utf8');
    const run = await cli(['assemble', '--plan', planPath], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.errors[0]?.code, 'schema-validation');
    assert.match(run.result.errors[0]?.message ?? '', /even/);
  });

  it('refuses --plan together with --job, and the job options without --job, as usage errors', async () => {
    const both = await cli(['assemble', '--plan', 'a.json', '--job', 'b'], dataDir);
    assert.equal(both.exitCode, 2);
    assert.match(both.result.errors[0]?.message ?? '', /not both/);
    const stray = await cli(['assemble', '--plan', 'a.json', '--codec', 'hevc'], dataDir);
    assert.equal(stray.exitCode, 2);
    assert.match(stray.result.errors[0]?.message ?? '', /go with --job/);
  });

  describe('with the installed ffmpeg', { skip: ffmpeg === undefined || ffprobe === undefined ? 'ffmpeg is not installed' : false }, () => {
    it('assembles plan (b) end to end, verifies 50 frames and lists the delivery as its artifact', async () => {
      if (ffmpeg === undefined) return;
      const sources = await makeSyntheticSources(ffmpeg.path, join(dataDir, 'src'));
      const outputPath = join(dataDir, 'delivery', 'film.mp4');
      const plan = makePlan(sources, outputPath, { transitions: [{ afterClipId: 'a', type: 'dissolve', frames: 10 }] });
      const planPath = join(dataDir, 'plan-b.json');
      writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
      const run = await cli(['assemble', '--plan', planPath, '--verbose'], dataDir);
      assert.equal(run.exitCode, 0, run.stderr);
      assert.equal(run.result.ok, true);
      assert.equal(run.result.command, 'assemble');
      const data = run.result.data as AssembleData;
      assert.equal(data.outputPath, outputPath);
      assert.equal(data.durationFrames, 50);
      assert.ok(Math.abs(data.durationSeconds - 50 / 30) < 1e-9);
      assert.equal(data.codec, 'h264');
      assert.deepEqual(data.verified, { frames: 50, fps: 30, width: 320, height: 180, colorSpace: 'bt709' });
      assert.equal(data.loudness, undefined);
      assert.deepEqual(run.result.artifacts, [outputPath]);
      assert.match(run.stderr, /debug: .*-filter_complex/);
    });
  });
});

describe('assemble --job option parsing', () => {
  it('takes h264 by default and refuses a codec outside the three', () => {
    assert.equal(parseCodec(undefined), 'h264');
    assert.equal(parseCodec('prores'), 'prores');
    assert.throws(() => parseCodec('av1'), (error: unknown) => error instanceof UsageError && /h264, hevc, prores/.test(error.message));
  });

  it('reads the narration files from a narration document, refuses anything else, and refuses a document whose WAV or SRT is gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-narration-doc-'));
    try {
      const path = narrationDocumentPath(dir);
      assert.equal(path, join(dir, 'narration', 'narration.json'));
      const wavPath = join(dir, 'narration', 'narration.wav');
      const srtPath = join(dir, 'narration', 'captions.srt');
      mkdirSync(dirname(wavPath), { recursive: true });
      writeFileSync(wavPath, 'not really a wav', 'utf8');
      writeFileSync(srtPath, '', 'utf8');
      writeJsonAtomic(path, { kind: 'narration', version: 1, wavPath, srtPath, sentences: [] });
      assert.deepEqual(readNarrationFiles(path), { wavPath, srtPath });
      // A missing input is named before any program runs, not found by ffmpeg once the job has moved.
      rmSync(wavPath);
      assert.throws(() => readNarrationFiles(path), (error: unknown) => error instanceof DataFileError && /its wavPath .*narration\.wav does not exist/.test(error.message) && /audio synth/.test(error.hint));
      writeJsonAtomic(path, { kind: 'job' });
      assert.throws(() => readNarrationFiles(path), (error: unknown) => error instanceof DataFileError && /narration document/.test(error.message));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('node scripts/cli.ts assemble --job', { skip: ffmpeg === undefined || ffprobe === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  let dataDir = '';
  let jobDir = '';
  let jobId = '';
  before(async () => {
    if (ffmpeg === undefined) return;
    dir = mkdtempSync(join(tmpdir(), 'vf-cli-asm-job-'));
    dataDir = join(dir, 'data');
    const documents = writeFixtureDocuments(dir);
    const planned = await cli(['plan', '--brief', documents.brief, '--treatment', documents.treatment, '--shot-spec', documents.shotSpec, '--look', documents.look], dataDir);
    assert.equal(planned.exitCode, 0, planned.stderr);
    jobDir = (planned.result.data as { readonly jobDir: string }).jobDir;
    jobId = (readJsonFile(join(jobDir, 'job.json')) as Job).id;
  });
  after(() => { if (dir.length > 0) rmSync(dir, { recursive: true, force: true }); });

  it('refuses a job whose shots are not rendered with shot-not-rendered, naming the shot and the render command, before any program runs', async () => {
    const run = await cli(['assemble', '--job', jobDir], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'shot-not-rendered');
    assert.match(run.result.errors[0]?.message ?? '', /Shot "s01" is not rendered: its status is pending/);
    assert.match(run.result.errors[0]?.hint ?? '', /Run render first/);
    assert.ok(!existsSync(join(jobDir, jobAssemblyFileNames.plan)), 'no plan is written for a job that cannot be assembled');
    assert.ok(!existsSync(join(jobDir, jobAssemblyFileNames.cube)), 'no cube is written for a job that cannot be assembled');
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/);
  });

  it('refuses --music-gain without --music and a music file that does not exist', async () => {
    const gain = await cli(['assemble', '--job', jobDir, '--music-gain', '-6'], dataDir);
    assert.equal(gain.exitCode, 2);
    assert.match(gain.result.errors[0]?.message ?? '', /--music-gain needs --music/);
    const missing = await cli(['assemble', '--job', jobDir, '--music', join(dir, 'nope.wav')], dataDir);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.result.errors[0]?.code, 'data-file');
  });

  it('builds the plan from the rendered job, writes it as evidence, assembles 300 frames and moves the job to qa with its delivery', async () => {
    if (ffmpeg === undefined) return;
    await renderFixtureJob(jobDir, dataDir, ffmpeg.path);
    const run = await cli(['assemble', '--job', join(jobDir, 'job.json')], dataDir);
    assert.equal(run.exitCode, 0, `${JSON.stringify(run.result.errors)}\n${run.stderr}`);
    const data = run.result.data as AssembleData;
    const deliveryPath = join(jobDir, `${jobId}.mp4`);
    assert.equal(data.outputPath, deliveryPath);
    assert.equal(data.codec, 'h264');
    assert.deepEqual(data.verified, { frames: 300, fps: 30, width: 320, height: 180, colorSpace: 'bt709' });
    assert.equal(data.loudness, undefined);
    assert.deepEqual(run.result.artifacts, [deliveryPath]);
    const planPath = join(jobDir, jobAssemblyFileNames.plan);
    assert.deepEqual(run.result.evidence, [planPath]);
    const plan = loadAssemblyPlan(planPath);
    assert.deepEqual(plan.clips.map((clip) => [clip.id, clip.durationFrames, clip.source.startNumber]), [['s01', 105, 0], ['s02', 90, 0], ['s03', 120, 0]]);
    assert.ok(plan.clips.every((clip) => /cache[\\/][0-9a-f]{64}[\\/]frames[\\/]f%06d\.png$/.test(clip.source.path)), plan.clips.map((clip) => clip.source.path).join('\n'));
    assert.deepEqual(plan.transitions, [{ afterClipId: 's01', type: 'dissolve', frames: 15 }]);
    assert.equal(plan.audio, undefined);
    assert.equal(plan.captions, undefined);
    assert.equal(plan.grade?.cubePath, join(jobDir, jobAssemblyFileNames.cube));
    assert.ok(existsSync(plan.grade?.cubePath ?? ''), 'the look\'s LUT is written beside the plan');
    assert.deepEqual(plan.output, { path: deliveryPath, codec: 'h264', crf: 16, preset: 'medium', faststart: true });
    const job = readJsonFile(join(jobDir, 'job.json')) as Job;
    assert.equal(job.status, 'qa');
    assert.equal(job.deliverablePath, deliveryPath);
  });

  it('places the narration the job folder holds, lists the SRT sidecar and reports the loudness; --out-file names the delivery', async () => {
    if (ffmpeg === undefined) return;
    const narrationDir = join(jobDir, 'narration');
    mkdirSync(narrationDir, { recursive: true });
    const wavPath = join(narrationDir, 'narration.wav');
    const srtPath = join(narrationDir, 'captions.srt');
    await runner.run({ label: 'ffmpeg (test)', executable: ffmpeg.path, args: ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=2', '-c:a', 'pcm_s16le', wavPath], cwd: dir, timeoutMs: 60_000 }, never);
    writeFileSync(srtPath, '1\n00:00:00,200 --> 00:00:01,800\nA content hash names the frames.\n', 'utf8');
    writeJsonAtomic(narrationDocumentPath(jobDir), { kind: 'narration', version: 1, voice: 'af_heart', text: 'A content hash names the frames.', sentences: [{ text: 'A content hash names the frames.', startSeconds: 0.2, endSeconds: 1.8, startFrame: 6, endFrame: 54 }], totalFrames: 60, fps: 30, sampleRate: 24000, wavPath, srtPath, loudness: { integratedLufs: -16, truePeakDbtp: -1.5 }, synthesisSeconds: 1, directMlMapped: false });
    const outFile = join(dir, 'delivery', 'film.mp4');
    const run = await cli(['assemble', '--job', jobDir, '--out-file', outFile], dataDir);
    assert.equal(run.exitCode, 0, `${JSON.stringify(run.result.errors)}\n${run.stderr}`);
    const data = run.result.data as AssembleData;
    assert.equal(data.outputPath, outFile);
    assert.ok(data.loudness !== undefined && Number.isFinite(data.loudness.inputI), 'the mix was measured');
    assert.deepEqual(run.result.artifacts, [outFile, join(dir, 'delivery', 'film.srt')]);
    const plan = loadAssemblyPlan(join(jobDir, jobAssemblyFileNames.plan));
    assert.deepEqual(plan.audio, { narration: [{ path: wavPath, startFrame: 0 }], music: null, loudnessLufs: -16, truePeakDbtp: -1.5 });
    assert.deepEqual({ srtPath: plan.captions?.srtPath, burnIn: plan.captions?.burnIn }, { srtPath, burnIn: false });
    assert.equal(plan.captions?.style?.fontSizePx, 8, 'the caption style scales with the fixture height down to the schema floor');
    assert.equal((readJsonFile(join(jobDir, 'job.json')) as Job).deliverablePath, outFile);
  });

  it('leaves a job whose assemble did not finish at assembling with no delivery recorded, so qa cannot measure the previous one', async () => {
    if (ffmpeg === undefined) return;
    // A music file ffmpeg cannot decode: parseMusic sees it exists, the plan builds, the encode fails.
    const music = join(dir, 'music.wav');
    writeFileSync(music, 'not really a wav', 'utf8');
    const run = await cli(['assemble', '--job', jobDir, '--music', music], dataDir);
    assert.equal(run.exitCode, 1, run.stderr);
    assert.equal(run.result.ok, false);
    const job = readJsonFile(join(jobDir, 'job.json')) as Job;
    assert.equal(job.status, 'assembling');
    assert.equal(job.deliverablePath, null);
    assert.equal(loadAssemblyPlan(join(jobDir, jobAssemblyFileNames.plan)).audio?.music?.path, music, 'the plan of the failed run is left as evidence');
  });
});
