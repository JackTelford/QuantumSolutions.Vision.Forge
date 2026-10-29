import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../../src/cli/arguments.ts';
import type { CommandContext } from '../../src/cli/command.ts';
import type { ApproveData, StillData } from '../../src/cli/commands/still.ts';
import { command as stillCommand, scaledStillPath, stillPaths } from '../../src/cli/commands/still.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { BlenderRenderError } from '../../src/errors/blender-errors.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { gateReportPath } from '../../src/render/still-gate.ts';
import type { StillGateReport } from '../../src/render/still-gate.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import type { ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { blenderCommand } from '../../src/tools/blender.ts';
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

describe('still command helpers', () => {
  it('names the files of a review round', () => {
    const paths = stillPaths('C:\\j', 's03', 2);
    assert.equal(paths.still, join('C:\\j', 'stills', 's03-r2.png'));
    assert.equal(paths.raw, join('C:\\j', 'stills', 's03-r2.raw.png'));
    assert.equal(scaledStillPath(paths.still, 2), join('C:\\j', 'stills', 's03-r2-2x.png'));
  });
});

describe('still command without a browser', () => {
  let dir = '';
  let dataDir = '';
  let jobDir = '';
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-still-'));
    dataDir = join(dir, 'data');
    jobDir = await planJob(dir, dataDir, 1920, 1080);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is a usage error without --job, with an unknown shot, a frame past the end, a bad renderer or a bad scale', async () => {
    const noJob = await cli(['still', '--shot', 's03'], dataDir);
    assert.equal(noJob.exitCode, 2);
    assert.match(noJob.result.errors[0]?.message ?? '', /Missing --job/);
    const noShot = await cli(['still', '--job', jobDir, '--shot', 's99'], dataDir);
    assert.equal(noShot.exitCode, 2);
    assert.equal(noShot.result.errors[0]?.code, 'usage');
    assert.match(noShot.result.errors[0]?.hint ?? '', /s01, s02, s03/);
    const badFrame = await cli(['still', '--job', join(jobDir, 'job.json'), '--shot', 's03', '--frame', '500'], dataDir);
    assert.equal(badFrame.exitCode, 2);
    assert.match(badFrame.result.errors[0]?.message ?? '', /--frame 500 is out of range for shot "s03", which has frames 0 to 119/);
    const badRenderer = await cli(['still', '--job', jobDir, '--shot', 's03', '--renderer', 'gpu'], dataDir);
    assert.equal(badRenderer.exitCode, 2);
    const badScale = await cli(['still', '--job', jobDir, '--shot', 's03', '--scale', '0'], dataDir);
    assert.equal(badScale.exitCode, 2);
  });

  it('asks for doctor on a blender shot without tools.json, and for Blender with the install command when tools.json has none', async () => {
    const spec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { copy.shots[1]!.lane = 'blender'; }));
    const noTools = await cli(['still', '--job', jobDir, '--shot', 's02'], dataDir);
    assert.equal(noTools.exitCode, 1);
    assert.equal(noTools.result.errors[0]?.code, 'data-file');
    assert.match(noTools.result.errors[0]?.hint ?? '', /Run doctor/);
    const blenderless = join(dir, 'blenderless');
    writeToolsManifest(blenderless, toolsManifestExample('C:\\tools\\ffmpeg.exe', [edgeExample]));
    const noBlender = await cli(['still', '--job', jobDir, '--shot', 's02'], blenderless);
    assert.equal(noBlender.exitCode, 1);
    assert.equal(noBlender.result.errors[0]?.code, 'tool-missing');
    assert.ok((noBlender.result.errors[0]?.hint ?? '').includes(blenderCommand()), 'the hint carries this platform\'s install command');
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), spec);
  });

  it('asks for doctor when there is no tools.json, before any browser launch', async () => {
    const run = await cli(['still', '--job', jobDir, '--shot', 's03'], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'data-file');
    assert.match(run.result.errors[0]?.hint ?? '', /Run doctor/);
  });

  it('refuses to approve a shot without a still', async () => {
    const run = await cli(['still', '--job', jobDir, '--shot', 's03', '--approve'], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'still-not-rendered');
    assert.match(run.result.errors[0]?.message ?? '', /its status is pending/);
  });

  it('refuses --approve beside a render option instead of ignoring it', async () => {
    const run = await cli(['still', '--job', jobDir, '--shot', 's03', '--scale', '2', '--approve'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.match(run.result.errors[0]?.message ?? '', /--approve takes no --frame, --scale or --renderer/);
  });

  it('approves a still-rendered shot whose latest gate report passed, and refuses one whose report failed', async () => {
    const jobPath = join(jobDir, 'job.json');
    const job = readJsonFile(jobPath) as Job;
    const stillPath = stillPaths(jobDir, 's03', 1).still;
    const rendered = { ...job.shots[2]!, status: 'still-rendered' as const, rounds: 1, stillPath };
    writeJsonAtomic(jobPath, { ...job, status: 'stills', shots: [job.shots[0]!, job.shots[1]!, rendered] });
    const failedReport: StillGateReport = { passed: false, checks: [{ id: 'exposure', ok: false, measured: 200, threshold: null, detail: 'average luma 200 YAVG outside the look\'s band 24 to 140' }] };
    writeJsonAtomic(gateReportPath(stillPath), failedReport);
    const refused = await cli(['still', '--job', jobDir, '--shot', 's03', '--approve'], dataDir);
    assert.equal(refused.exitCode, 1);
    assert.equal(refused.result.errors[0]?.code, 'still-gate');
    assert.match(refused.result.errors[0]?.message ?? '', /exposure: average luma 200/);
    assert.deepEqual(refused.result.evidence, [gateReportPath(stillPath), stillPath]);
    assert.equal((readJsonFile(jobPath) as Job).shots[2]?.status, 'still-rendered');

    writeJsonAtomic(gateReportPath(stillPath), { passed: true, checks: [] });
    const approved = await cli(['still', '--job', jobDir, '--shot', 's03', '--approve'], dataDir);
    assert.equal(approved.exitCode, 0, approved.stderr);
    assert.deepEqual(approved.result.data as ApproveData, { jobId: job.id, shotId: 's03', status: 'still-approved' });
    assert.deepEqual(approved.result.evidence, [gateReportPath(stillPath)]);
    assert.equal((readJsonFile(jobPath) as Job).shots[2]?.status, 'still-approved');
    const twice = await cli(['still', '--job', jobDir, '--shot', 's03', '--approve'], dataDir);
    assert.equal(twice.result.errors[0]?.code, 'still-not-rendered');
  });
});

describe('still command on a blender shot through a fake Blender', () => {
  let dir = '';
  let dataDir = '';
  let jobDir = '';
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-still-blender-'));
    dataDir = join(dir, 'data');
    jobDir = await planJob(dir, dataDir, 480, 270);
    const manifest = toolsManifestExample('C:\\tools\\ffmpeg.exe', [edgeExample]);
    writeToolsManifest(dataDir, { ...manifest, programs: { ...manifest.programs, blender: { path: 'C:\\Blender\\blender.exe', version: '5.2.3', devices: [{ name: 'RTX 2060', type: 'OPTIX' }, { name: 'RTX 2060', type: 'CUDA' }, { name: 'i7', type: 'CPU' }] } } });
    const spec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { copy.shots[1]!.lane = 'blender'; }));
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  /** Runs the still command in this process with the fake runner standing in for Blender and ffmpeg. */
  function runStill(runner: FakeBlenderRunner, args: readonly string[], log = new MemoryLogger()): ReturnType<typeof stillCommand.run> {
    const context: CommandContext = { dataDir, outDir: join(dataDir, 'out'), cwd: repoRoot, runner, signal: never, log, now: (): Date => new Date() };
    return stillCommand.run(context, parseArguments(['--job', jobDir, '--shot', 's02', ...args], stillCommand.options));
  }

  it('reports the bottom rung\'s failure when every rung fails, keeps the scratch folder with the scene documents and leaves the job as it was', async () => {
    const before = readJsonFile(join(jobDir, 'job.json')) as Job;
    const failure = { exitCode: 1, writeFrames: false, stderr: 'Error: boom' };
    const runner = new FakeBlenderRunner([failure, failure, failure, failure, failure]);
    const log = new MemoryLogger();
    await assert.rejects(runStill(runner, [], log), (error: unknown) => error instanceof BlenderRenderError && error.code === 'blender-render' && /boom/.test(error.message));
    assert.equal(runner.blenderRuns.length, 5, 'every rung was tried');
    const paths = stillPaths(jobDir, 's02', 1);
    const sceneDir = join(paths.workDir, 'blender', 'cycles-CPU', 'scene', 'cycles-CPU');
    const batches = readdirSync(sceneDir);
    assert.equal(batches.length, 1, 'one batch of one frame');
    assert.ok(existsSync(join(sceneDir, batches[0]!, 'scene.json')), 'the scene documents stay for a reader');
    assert.ok(log.messages.some((message) => /kept under/.test(message)));
    assert.deepEqual(readJsonFile(join(jobDir, 'job.json')), before);
  });

  it('renders the still with the first rung of the ladder, grades it, runs the gate, pins eevee on opengl and re-keys the shot without caching the frame', async () => {
    const planned = (readJsonFile(join(jobDir, 'job.json')) as Job).shots[1]!;
    const runner = new FakeBlenderRunner();
    const log = new MemoryLogger();
    const output = await runStill(runner, [], log);
    const data = output.data as StillData;
    assert.deepEqual(data.renderProfile, { engine: 'eevee', backend: 'opengl', renderer: 'hardware' });
    assert.equal(data.passed, true);
    assert.deepEqual(data.checks.map((check) => check.id), ['composition', 'text-contrast', 'exposure']);
    assert.equal(data.round, 1);
    const paths = stillPaths(jobDir, 's02', 1);
    for (const path of [paths.still, paths.raw, gateReportPath(paths.still)]) assert.ok(existsSync(path), path);
    assert.ok(!existsSync(paths.workDir), 'the scratch folder with the attempts is removed');
    assert.ok(!existsSync(join(dataDir, 'cache')), 'the still of a blender shot is not cached: a still renders with more samples than a clip');
    assert.equal(runner.blenderRuns.length, 1);
    const run = runner.blenderRuns[0]!;
    assert.deepEqual(run.args.slice(0, 7), ['-b', '--factory-startup', '--disable-autoexec', '-noaudio', '--offline-mode', '--gpu-backend', 'opengl']);
    assert.equal(run.env?.['BLENDER_USER_RESOURCES'], join(dataDir, 'blender-user'));
    const job = readJsonFile(join(jobDir, 'job.json')) as Job;
    assert.equal(job.status, 'stills');
    assert.equal(job.shots[1]?.status, 'still-rendered');
    assert.equal(job.shots[1]?.rounds, 1);
    assert.notEqual(job.shots[1]?.key, planned.key, 'the key changes once at the gate');
    const spec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
    assert.deepEqual(spec.shots[1]?.renderProfile, data.renderProfile);
    assert.ok(log.messages.some((message) => /blender ladder for 480x270: eevee-opengl, eevee-vulkan, cycles-OPTIX, cycles-CUDA, cycles-CPU/.test(message)), log.messages.join('\n'));
    assert.deepEqual(output.artifacts, [paths.still]);
    assert.deepEqual(output.evidence, [gateReportPath(paths.still), paths.still]);
  });

  it('moves down the ladder when a rung fails and pins the rung that rendered', async () => {
    const runner = new FakeBlenderRunner([{ exitCode: 1, writeFrames: false, stderr: 'gpu.init() failed: no OpenGL context' }]);
    const log = new MemoryLogger();
    const output = await runStill(runner, [], log);
    const data = output.data as StillData;
    assert.deepEqual(data.renderProfile, { engine: 'eevee', backend: 'vulkan', renderer: 'hardware' });
    assert.equal(data.round, 2);
    assert.equal(runner.blenderRuns.length, 2);
    assert.equal(runner.blenderRuns[1]?.args[6], 'vulkan');
    assert.ok(log.messages.some((message) => /warn: blender attempt eevee-opengl failed \(blender-render\).*no OpenGL context/.test(message)), log.messages.join('\n'));
    assert.deepEqual((readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec).shots[1]?.renderProfile, data.renderProfile);
  });

  it('takes the CPU rung alone under --renderer software', async () => {
    const runner = new FakeBlenderRunner();
    const data = (await runStill(runner, ['--renderer', 'software'])).data as StillData;
    assert.deepEqual(data.renderProfile, { engine: 'cycles', backend: 'CPU', renderer: 'software' });
    assert.equal(runner.blenderRuns.length, 1);
    assert.ok(!runner.blenderRuns[0]?.args.includes('--gpu-backend'));
  });

});

// Optional: the whole still path on the real browser. It depends on the harness and the html lane landing
// (src/harness/browser-session.ts, src/browser/runtime/boot.ts) and on Edge or Chrome being installed.
const harnessPresent = existsSync(join(repoRoot, 'src', 'harness', 'browser-session.ts')) && existsSync(join(repoRoot, 'src', 'browser', 'runtime', 'boot.ts'));
const browserPresent = testBrowser() !== undefined;
const skipIntegration = !harnessPresent ? 'the browser harness has not landed' : !browserPresent ? 'no Edge or Chrome is installed' : false;

describe('still command on the real browser at 480x270', { skip: skipIntegration }, () => {
  let dir = '';
  let dataDir = '';
  let jobDir = '';
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-still-browser-'));
    dataDir = join(dir, 'data');
    const doctor = await cli(['doctor', '--skip-browser-check', '--skip-blender-probe'], dataDir, 180_000);
    assert.equal(doctor.exitCode, 0, doctor.stderr);
    preferTestBrowserInManifest(dataDir);
    jobDir = await planJob(dir, dataDir, 480, 270);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('renders the default frame of the html shot, grades it, runs the gate, pins the profile and re-keys the shot', async () => {
    const planned = (readJsonFile(join(jobDir, 'job.json')) as Job).shots[2]!;
    const run = await cli(['still', '--job', jobDir, '--shot', 's03'], dataDir, 180_000);
    const paths = stillPaths(jobDir, 's03', 1);
    // The fixture passes the gate with margin (text contrast about 15:1, YAVG about 35 in 24..140); a failure here names its check.
    assert.equal(run.exitCode, 0, `${JSON.stringify(run.result.errors)}\n${run.stderr}`);
    for (const path of [paths.still, paths.raw, gateReportPath(paths.still), paths.still.replace(/\.png$/, '.cube')]) assert.ok(existsSync(path), path);
    const report = readJsonFile(gateReportPath(paths.still)) as StillGateReport;
    assert.deepEqual(report.checks.map((check) => check.id), ['composition', 'text-contrast', 'exposure']);
    for (const check of report.checks) assert.ok(check.ok, `gate ${check.id}: ${check.detail}`);
    assert.ok(!existsSync(paths.workDir), 'the scratch folder is removed');
    const job = readJsonFile(join(jobDir, 'job.json')) as Job;
    assert.equal(job.status, 'stills');
    assert.equal(job.shots[2]?.status, 'still-rendered');
    assert.equal(job.shots[2]?.rounds, 1);
    assert.equal(job.shots[2]?.stillPath, paths.still);
    assert.notEqual(job.shots[2]?.key, planned.key, 'the key changes once at the gate');
    const spec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
    assert.equal(spec.shots[2]?.renderProfile?.engine, 'chromium');
    assert.ok(existsSync(join(dataDir, 'cache', job.shots[2]?.key ?? '', 'manifest.json')), 'the still frame is cached under the new key');
    const data = run.result.data as StillData;
    assert.equal(data.round, 1);
    assert.equal(data.passed, true);
    assert.equal(data.frame, 26);
    assert.deepEqual(run.result.artifacts, [paths.still]);
    assert.deepEqual(run.result.evidence, [gateReportPath(paths.still), paths.still]);
  });
});
