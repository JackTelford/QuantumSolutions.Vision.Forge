import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { RenderData } from '../../src/cli/commands/render.ts';
import { jobPageDir } from '../../src/cli/commands/render.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { readManifest } from '../../src/render/manifest.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import type { ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { findBrowsers } from '../../src/tools/browsers.ts';
import { planBrief, planLook, planShotSpec, planTreatment } from '../plan/fixtures.ts';
import { mutated } from '../schema/documents/examples.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function cli(args: readonly string[], dataDir: string, timeoutMs = 60_000): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}\n${result.stderr}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

/** Writes the fixture quartet (scaled to the given size) under a folder and plans it; returns the job folder. */
async function planJob(dir: string, dataDir: string, width: number, height: number): Promise<string> {
  writeJsonAtomic(join(dir, 'brief.json'), mutated(planBrief, (copy) => { copy.width = width; copy.height = height; }));
  writeJsonAtomic(join(dir, 'treatment.json'), planTreatment);
  writeJsonAtomic(join(dir, 'shot-spec.json'), mutated(planShotSpec, (copy) => { copy.width = width; copy.height = height; }));
  writeJsonAtomic(join(dir, 'look.json'), planLook);
  const run = await cli(['plan', '--brief', join(dir, 'brief.json'), '--treatment', join(dir, 'treatment.json'), '--shot-spec', join(dir, 'shot-spec.json'), '--look', join(dir, 'look.json')], dataDir);
  assert.equal(run.exitCode, 0, run.stderr);
  return (run.result.data as { readonly jobDir: string }).jobDir;
}

describe('render command without a browser', () => {
  let dir = '';
  let dataDir = '';
  let jobDir = '';
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-render-'));
    dataDir = join(dir, 'data');
    jobDir = await planJob(dir, dataDir, 1920, 1080);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is a usage error without --job, with an unknown shot, a malformed or out-of-range --frames or a bad renderer', async () => {
    const noJob = await cli(['render'], dataDir);
    assert.equal(noJob.exitCode, 2);
    assert.equal(noJob.result.errors[0]?.code, 'usage');
    assert.match(noJob.result.errors[0]?.message ?? '', /Missing --job/);
    const noShot = await cli(['render', '--job', jobDir, '--shot', 's99'], dataDir);
    assert.equal(noShot.exitCode, 2);
    assert.match(noShot.result.errors[0]?.hint ?? '', /s01, s02, s03/);
    const badRange = await cli(['render', '--job', jobDir, '--shot', 's03', '--frames', '0-500', '--allow-unapproved'], dataDir);
    assert.equal(badRange.exitCode, 2);
    assert.match(badRange.result.errors[0]?.message ?? '', /--frames 0-500 is out of range for shot "s03", which has frames 0 to 119/);
    const malformed = await cli(['render', '--job', jobDir, '--frames', 'all'], dataDir);
    assert.equal(malformed.exitCode, 2);
    const badRenderer = await cli(['render', '--job', jobDir, '--renderer', 'cpu'], dataDir);
    assert.equal(badRenderer.exitCode, 2);
  });

  it('refuses an unapproved shot with code shot-not-approved and names the still command', async () => {
    const run = await cli(['render', '--job', join(jobDir, 'job.json'), '--shot', 's03'], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'shot-not-approved');
    assert.match(run.result.errors[0]?.message ?? '', /Shot "s03" is not approved for rendering: its status is pending/);
    assert.match(run.result.errors[0]?.hint ?? '', /still --job .* --shot s03/);
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/);
  });

  it('refuses a renderer that disagrees with the pinned profile before any launch', async () => {
    const run = await cli(['render', '--job', jobDir, '--shot', 's01', '--renderer', 'software', '--allow-unapproved'], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'render-profile-mismatch');
    assert.match(run.result.errors[0]?.message ?? '', /"s01" was pinned to the hardware renderer.*--renderer software/);
  });

  it('refuses a blender shot named with --shot, and a job whose every shot is blender', async () => {
    const spec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { copy.shots[1]!.lane = 'blender'; }));
    const named = await cli(['render', '--job', jobDir, '--shot', 's02'], dataDir);
    assert.equal(named.exitCode, 1);
    assert.equal(named.result.errors[0]?.code, 'lane-unavailable');
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { for (const shot of copy.shots) shot.lane = 'blender'; }));
    const all = await cli(['render', '--job', jobDir], dataDir);
    assert.equal(all.exitCode, 1);
    assert.equal(all.result.errors[0]?.code, 'lane-unavailable');
    assert.match(all.stderr, /warning: shot "s01" uses the blender lane and is skipped/);
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), spec);
  });

  it('asks for doctor when a shot is allowed through but there is no tools.json', async () => {
    const run = await cli(['render', '--job', jobDir, '--shot', 's03', '--allow-unapproved'], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'data-file');
    assert.match(run.result.errors[0]?.hint ?? '', /Run doctor/);
    assert.match(run.stderr, /warning: shot "s03" renders unapproved/);
  });
});

// Optional: the whole render path on the real browser. It depends on the harness and the html lane landing
// (src/harness/browser-session.ts, src/browser/runtime/boot.ts) and on Edge or Chrome being installed.
const harnessPresent = existsSync(join(repoRoot, 'src', 'harness', 'browser-session.ts')) && existsSync(join(repoRoot, 'src', 'browser', 'runtime', 'boot.ts'));
const browserPresent = findBrowsers().found.length > 0;
const skipIntegration = !harnessPresent ? 'the browser harness has not landed' : !browserPresent ? 'no Edge or Chrome is installed' : false;

describe('render command on the real browser at 480x270', { skip: skipIntegration }, () => {
  let dir = '';
  let dataDir = '';
  let jobDir = '';
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-render-browser-'));
    dataDir = join(dir, 'data');
    const doctor = await cli(['doctor', '--skip-browser-check', '--skip-blender-probe'], dataDir, 180_000);
    assert.equal(doctor.exitCode, 0, doctor.stderr);
    jobDir = await planJob(dir, dataDir, 480, 270);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('renders frames 0-11 of the html shot into the cache with a valid manifest and records the manifest on the job', async () => {
    const run = await cli(['render', '--job', jobDir, '--shot', 's03', '--frames', '0-11', '--allow-unapproved'], dataDir, 300_000);
    assert.equal(run.exitCode, 0, `${JSON.stringify(run.result.errors)}\n${run.stderr}`);
    const data = run.result.data as RenderData;
    assert.equal(data.shots.length, 1);
    const shot = data.shots[0]!;
    assert.deepEqual([shot.id, shot.lane, shot.frames, shot.reused], ['s03', 'html', 12, 0]);
    assert.equal(data.totalFrames, 12);
    assert.ok(shot.msPerFrame > 0);
    assert.equal(shot.framesDir, join(dataDir, 'cache', shot.key, 'frames'));
    assert.deepEqual(readdirSync(shot.framesDir).sort(), Array.from({ length: 12 }, (_, frame) => `f${String(frame).padStart(6, '0')}.png`));
    const manifest = readManifest(shot.manifestPath);
    validateDocument('render-manifest', manifest);
    assert.equal(manifest.status, 'rendering');
    assert.equal(manifest.frames.length, 12);
    assert.equal(manifest.frameCount, 120);
    assert.equal(manifest.key, shot.key);
    assert.equal(manifest.fingerprint.browser?.args.at(-1)?.startsWith('--use-angle='), true);
    assert.deepEqual(run.result.evidence, [shot.manifestPath]);
    const job = readJsonFile(join(jobDir, 'job.json')) as Job;
    assert.equal(job.status, 'rendering');
    assert.equal(job.shots[2]?.manifestPath, shot.manifestPath);
    assert.equal(job.shots[2]?.status, 'pending', 'not every frame is rendered yet');
    assert.ok(existsSync(join(jobPageDir(jobDir), 'index.html')));
    assert.match(run.stderr, /^s03 {2}html {2}12 frames {2}\d+ ms {2}[0-9.]+ ms\/frame {2}0 reused$/m);
  });

  it('reuses every frame on a second run and completes the shot on a whole-shot run', async () => {
    const again = await cli(['render', '--job', jobDir, '--shot', 's03', '--frames', '0-11', '--allow-unapproved'], dataDir, 300_000);
    assert.equal(again.exitCode, 0, again.stderr);
    const reused = (again.result.data as RenderData).shots[0]!;
    assert.deepEqual([reused.frames, reused.reused, reused.msPerFrame], [12, 12, 0]);

    const whole = await cli(['render', '--job', jobDir, '--shot', 's03', '--allow-unapproved'], dataDir, 600_000);
    assert.equal(whole.exitCode, 0, whole.stderr);
    const complete = (whole.result.data as RenderData).shots[0]!;
    assert.deepEqual([complete.frames, complete.reused], [120, 12]);
    assert.equal(readManifest(complete.manifestPath).status, 'complete');
    assert.equal((readJsonFile(join(jobDir, 'job.json')) as Job).shots[2]?.status, 'rendered');

    const cached = await cli(['render', '--job', jobDir, '--shot', 's03'], dataDir, 300_000);
    assert.equal(cached.exitCode, 0, cached.stderr);
    const kept = (cached.result.data as RenderData).shots[0]!;
    assert.deepEqual([kept.frames, kept.reused, kept.elapsedMs], [120, 120, 0]);
    assert.match(cached.stderr, /already rendered; reused/);
  });
});
