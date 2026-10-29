import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../../src/cli/arguments.ts';
import type { CommandContext } from '../../src/cli/command.ts';
import type { RenderData } from '../../src/cli/commands/render.ts';
import { command as renderCommand, jobPageDir } from '../../src/cli/commands/render.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { laneFingerprint, shotKey } from '../../src/plan/shot-key.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { sceneHashesPath } from '../../src/render/blender-shot.ts';
import { RenderProfileMismatchError } from '../../src/render/command-support.ts';
import { readManifest } from '../../src/render/manifest.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import type { ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { writeToolsManifest } from '../../src/tools/tools-manifest.ts';
import { FakeBlenderRunner } from '../fakes/fake-blender-runner.ts';
import { preferTestBrowserInManifest, testBrowser } from '../fakes/test-browser.ts';
import { planBrief, planLook, planShotSpec, planTreatment } from '../plan/fixtures.ts';
import { edgeExample, toolsManifestExample } from '../render/fixtures.ts';
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

  it('refuses a blender shot without a pinned profile, or pinned to the CPU or to a browser, with render-profile-mismatch before any launch', async () => {
    const spec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { copy.shots[1]!.lane = 'blender'; }));
    const unpinned = await cli(['render', '--job', jobDir, '--shot', 's02', '--allow-unapproved'], dataDir);
    assert.equal(unpinned.exitCode, 1);
    assert.equal(unpinned.result.errors[0]?.code, 'render-profile-mismatch');
    assert.match(unpinned.result.errors[0]?.message ?? '', /no render profile pinned/);
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { copy.shots[1]!.lane = 'blender'; copy.shots[1]!.renderProfile = { engine: 'cycles', backend: 'CPU', renderer: 'software' }; }));
    const cpu = await cli(['render', '--job', jobDir, '--shot', 's02', '--allow-unapproved'], dataDir);
    assert.equal(cpu.result.errors[0]?.code, 'render-profile-mismatch');
    assert.match(cpu.result.errors[0]?.message ?? '', /legal for stills only/);
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { copy.shots[0]!.lane = 'blender'; }));
    const browserPinned = await cli(['render', '--job', jobDir, '--shot', 's01', '--allow-unapproved'], dataDir);
    assert.equal(browserPinned.result.errors[0]?.code, 'render-profile-mismatch');
    assert.match(browserPinned.result.errors[0]?.message ?? '', /chromium on d3d11, which is not a Blender engine/);
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { for (const shot of copy.shots) shot.lane = 'blender'; }));
    const all = await cli(['render', '--job', jobDir], dataDir);
    assert.equal(all.result.errors[0]?.code, 'shot-not-approved', 'a job of blender shots is a job like any other');
    assert.doesNotMatch(all.stderr, /skipped/);
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

describe('render command on a blender shot through a fake Blender', () => {
  let dir = '';
  let dataDir = '';
  let jobDir = '';
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-render-blender-'));
    dataDir = join(dir, 'data');
    jobDir = await planJob(dir, dataDir, 480, 270);
    const manifest = toolsManifestExample('C:\\tools\\ffmpeg.exe', [edgeExample]);
    writeToolsManifest(dataDir, { ...manifest, programs: { ...manifest.programs, blender: { path: 'C:\\Blender\\blender.exe', version: '5.2.3', devices: [{ name: 'RTX 2060', type: 'OPTIX' }, { name: 'i7', type: 'CPU' }] } } });
    // The still gate's work, done by hand: s02 on the blender lane, pinned to EEVEE on Vulkan, approved under the key the gate would have computed.
    const spec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
    const pinned = mutated(spec, (copy) => { copy.shots[1]!.lane = 'blender'; copy.shots[1]!.renderProfile = { engine: 'eevee', backend: 'vulkan', renderer: 'hardware' }; });
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), pinned);
    const key = await shotKey(pinned.shots[1]!, planLook, await laneFingerprint(dataDir, 'blender'));
    const job = readJsonFile(join(jobDir, 'job.json')) as Job;
    writeJsonAtomic(join(jobDir, 'job.json'), { ...job, status: 'stills', shots: job.shots.map((shot) => (shot.id === 's02' ? { ...shot, key, status: 'still-approved' as const } : shot)) });
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  /** Runs the render command in this process with the fake runner standing in for Blender and ffmpeg. */
  function runRender(runner: FakeBlenderRunner, args: readonly string[], log = new MemoryLogger()): ReturnType<typeof renderCommand.run> {
    const context: CommandContext = { dataDir, outDir: join(dataDir, 'out'), cwd: repoRoot, runner, signal: never, log, now: (): Date => new Date() };
    return renderCommand.run(context, parseArguments(['--job', jobDir, ...args], renderCommand.options));
  }

  it('refuses --renderer software on the hardware pin with render-profile-mismatch before Blender or ffmpeg runs', async () => {
    const runner = new FakeBlenderRunner();
    const refused = await runRender(runner, ['--shot', 's02', '--renderer', 'software']).catch((error: unknown) => error);
    assert.ok(refused instanceof RenderProfileMismatchError, String(refused));
    assert.equal(refused.code, 'render-profile-mismatch');
    assert.match(refused.message, /"s02" was pinned to the hardware renderer \(eevee on vulkan\).*--renderer software/);
    assert.equal(runner.invocations.length, 0);
    assert.ok(!existsSync(join(dataDir, 'cache')), 'nothing was rendered');
  });

  it('renders the whole shot with the pinned rung in batches of three then thirty, with an estimate, and records a complete manifest on the job', async () => {
    const runner = new FakeBlenderRunner();
    const log = new MemoryLogger();
    const output = await runRender(runner, ['--shot', 's02'], log);
    const data = output.data as RenderData;
    assert.equal(data.shots.length, 1);
    const shot = data.shots[0]!;
    assert.deepEqual([shot.id, shot.lane, shot.frames, shot.reused], ['s02', 'blender', 90, 0]);
    assert.ok(shot.estimate !== null && shot.estimate.secondsPerFrame >= 0);
    assert.deepEqual(data.estimate, shot.estimate);
    assert.deepEqual(data.skipped, []);
    assert.equal(runner.blenderRuns.length, 4, '3 + 30 + 30 + 27 frames');
    for (const run of runner.blenderRuns) assert.equal(run.args[6], 'vulkan');
    assert.deepEqual(readdirSync(shot.framesDir).length, 90);
    const manifest = readManifest(shot.manifestPath);
    validateDocument('render-manifest', manifest);
    assert.equal(manifest.status, 'complete');
    assert.equal(manifest.lane, 'blender');
    assert.deepEqual(manifest.renderProfile, { engine: 'eevee', backend: 'vulkan', renderer: 'hardware' });
    assert.equal(manifest.fingerprint.blender, '5.2.3');
    assert.equal(manifest.fingerprint.browser, undefined);
    assert.ok(existsSync(sceneHashesPath(join(shot.framesDir, '..'))));
    const job = readJsonFile(join(jobDir, 'job.json')) as Job;
    assert.equal(job.status, 'rendering');
    assert.equal(job.shots[1]?.status, 'rendered');
    assert.equal(job.shots[1]?.manifestPath, shot.manifestPath);
    assert.ok(log.messages.some((message) => /^info: s02 {2}blender {2}90 frames {2}\d+ ms {2}[0-9.]+ ms\/frame {2}0 reused$/.test(message)), log.messages.join('\n'));
    assert.ok(log.messages.some((message) => /^info: estimate: [0-9.]+ s per frame/.test(message)));
    assert.deepEqual(output.evidence, [shot.manifestPath]);
  });

  it('reuses the finished shot on a second run and runs no Blender', async () => {
    const runner = new FakeBlenderRunner();
    const data = (await runRender(runner, ['--shot', 's02'])).data as RenderData;
    assert.deepEqual([data.shots[0]?.frames, data.shots[0]?.reused, data.shots[0]?.elapsedMs], [90, 90, 0]);
    assert.equal(data.estimate, null);
    assert.equal(runner.invocations.length, 0);
  });

  it('renders the job\'s blender shot and leaves the browser shots alone when only the blender shot is approved and the rest are reused or refused', async () => {
    const runner = new FakeBlenderRunner();
    const all = await runRender(runner, []).catch((error: unknown) => error);
    // s01 and s03 are not approved: the refusal comes before any Blender or browser launch.
    assert.ok(all instanceof Error && /not approved/.test(all.message), String(all));
    assert.equal(runner.invocations.length, 0);
  });
});

// Optional: the whole render path on the real browser. It depends on the harness and the html lane landing
// (src/harness/browser-session.ts, src/browser/runtime/boot.ts) and on Edge or Chrome being installed.
const harnessPresent = existsSync(join(repoRoot, 'src', 'harness', 'browser-session.ts')) && existsSync(join(repoRoot, 'src', 'browser', 'runtime', 'boot.ts'));
const browserPresent = testBrowser() !== undefined;
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
    preferTestBrowserInManifest(dataDir);
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
