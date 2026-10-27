import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AssembleData } from '../../src/cli/commands/assemble.ts';
import { loadAssemblyPlan, verifyDelivery } from '../../src/cli/commands/assemble.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { DataFileError, SchemaValidationError } from '../../src/errors/vision-forge-error.ts';
import type { AssemblyPlan } from '../../src/shared/contracts/assembly-plan.ts';
import { findFfmpeg, findFfprobe } from '../../src/tools/ffmpeg.ts';
import { makePlan, makeSyntheticSources, never, runner } from '../assemble/support.ts';
import type { SyntheticSources } from '../assemble/support.ts';

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
