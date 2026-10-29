import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ApproveData, StillData } from '../../src/cli/commands/still.ts';
import { scaledStillPath, stillPaths } from '../../src/cli/commands/still.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { gateReportPath } from '../../src/render/still-gate.ts';
import type { StillGateReport } from '../../src/render/still-gate.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import type { ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { preferTestBrowserInManifest, testBrowser } from '../fakes/test-browser.ts';
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

  it('refuses a blender shot with code lane-unavailable before touching any tool', async () => {
    const spec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
    writeJsonAtomic(join(jobDir, 'shot-spec.json'), mutated(spec, (copy) => { copy.shots[1]!.lane = 'blender'; }));
    const run = await cli(['still', '--job', jobDir, '--shot', 's02'], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'lane-unavailable');
    assert.match(run.result.errors[0]?.hint ?? '', /M5/);
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
