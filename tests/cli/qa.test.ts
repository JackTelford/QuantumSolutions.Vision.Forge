import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CliResult } from '../../src/cli/result.ts';
import type { QaData } from '../../src/cli/commands/qa.ts';
import { jobReportPath, jobShotStills, jobTextBoxes } from '../../src/cli/commands/qa.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { extractFrame } from '../../src/qa/frame-extract.ts';
import { defaultStillFrame } from '../../src/render/still-frame.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import type { QaReport } from '../../src/shared/contracts/qa-report.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { writeSolidPng } from '../fakes/png.ts';
import { planLook, planShotSpec } from '../plan/fixtures.ts';
import { ffmpegPath, makeBlackFreezeClip, makeBoxesClip, makeCleanClip, never, planFor, runner } from '../qa/synthetic-clips.ts';
import { jobExample, mutated } from '../schema/documents/examples.ts';
import { fixtureStillPath, renderFixtureJob, renderedJobSize, writeFixtureDocuments } from './rendered-job.ts';

const ffmpeg = findFfmpeg();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function cli(args: readonly string[], dataDir: string): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs: 120_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

describe('qa command', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dataDir = '';
  let clean = '';
  let faulty = '';
  before(async () => {
    if (ffmpeg === undefined) return;
    dataDir = mkdtempSync(join(tmpdir(), 'vf-cli-qa-'));
    clean = await makeCleanClip(dataDir);
    faulty = await makeBlackFreezeClip(dataDir);
  });
  after(() => { if (dataDir.length > 0) rmSync(dataDir, { recursive: true, force: true }); });

  it('passes a clean clip, exits 0 and writes a report under <out>/qa that validates', async () => {
    const run = await cli(['qa', '--video', clean], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.equal(run.result.ok, true);
    const data = run.result.data as QaData;
    assert.equal(data.passed, true);
    assert.deepEqual(data.failed, []);
    assert.equal(data.reportPath, join(dataDir, 'out', 'qa', 'clean.qa.json'));
    assert.deepEqual(run.result.evidence, [data.reportPath]);
    const report = readJsonFile(data.reportPath) as QaReport;
    validateDocument('qa-report', report);
    assert.deepEqual(report.checks.map((check) => check.id), ['dimensions', 'fps', 'duration', 'black-frames', 'frozen-frames', 'pops', 'exposure-drift', 'loudness', 'true-peak']);
    assert.deepEqual(report.subject, { kind: 'deliverable', path: clean, shotId: null });
    assert.match(run.stderr, /qa: black-frames ok/);
  });

  it('fails the black and frozen clip with exit 1, code qa-failed, the ids in the message and the report in the hint', async () => {
    const reportPath = join(dataDir, 'faulty.qa.json');
    const run = await cli(['qa', '--video', faulty, '--report', reportPath], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.errors[0]?.code, 'qa-failed');
    assert.match(run.result.errors[0]?.message ?? '', /black-frames/);
    assert.match(run.result.errors[0]?.message ?? '', /frozen-frames/);
    assert.ok((run.result.errors[0]?.hint ?? '').includes(reportPath));
    assert.deepEqual(run.result.evidence, [reportPath]);
    assert.ok(existsSync(reportPath));
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/);
    const report = readJsonFile(reportPath) as QaReport;
    assert.equal(report.passed, false);
    assert.deepEqual(report.checks.find((check) => check.id === 'black-frames')?.frames, [30]);
  });

  it('--no-fail writes the report and exits 0 with the failed ids in the payload', async () => {
    const run = await cli(['qa', '--video', faulty, '--no-fail'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as QaData;
    assert.equal(data.passed, false);
    for (const id of ['black-frames', 'frozen-frames', 'pops']) assert.ok(data.failed.includes(id as QaData['failed'][number]), `${id} in ${data.failed.join(', ')}`);
  });

  it('a plan that declares the cuts clears pops and holds the geometry to the plan', async () => {
    const planPath = join(dataDir, 'plan.json');
    writeFileSync(planPath, JSON.stringify(planFor([{ id: 'a', frames: 30 }, { id: 'b', frames: 15 }, { id: 'c', frames: 60 }])), 'utf8');
    const run = await cli(['qa', '--video', faulty, '--plan', planPath, '--no-fail'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as QaData;
    assert.ok(!data.failed.includes('pops'), data.failed.join(', '));
    assert.ok(data.failed.includes('frozen-frames'));
    const report = readJsonFile(data.reportPath) as QaReport;
    const duration = report.checks.find((check) => check.id === 'duration');
    assert.deepEqual([duration?.ok, duration?.measured, duration?.threshold], [true, 105, 105]);
    assert.deepEqual(report.checks.find((check) => check.id === 'frozen-frames')?.frames, [45]);
  });

  it('--text-boxes and --still with --still-frame add the text-contrast and hero-still-match checks', async () => {
    const boxes = await makeBoxesClip(dataDir);
    const still = join(dataDir, 'boxes-frame0.png');
    assert.equal(await extractFrame(runner, ffmpegPath(), boxes, 0, still, never), true);
    const boxesPath = join(dataDir, 'boxes.json');
    writeFileSync(boxesPath, JSON.stringify([{ frame: 0, box: { x: 0.1, y: 0.2, w: 0.4, h: 0.4 }, textColor: '#000000' }]), 'utf8');
    const run = await cli(['qa', '--video', boxes, '--text-boxes', boxesPath, '--still', still, '--still-frame', '0'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as QaData;
    assert.equal(data.passed, true);
    const report = readJsonFile(data.reportPath) as QaReport;
    validateDocument('qa-report', report);
    const ids = report.checks.map((check) => check.id);
    assert.ok(ids.includes('text-contrast') && ids.includes('hero-still-match'), ids.join(', '));
    const contrast = report.checks.find((check) => check.id === 'text-contrast');
    assert.equal(contrast?.ok, true, contrast?.detail);
    assert.ok((contrast?.measured ?? 0) > 19, contrast?.detail);
    const hero = report.checks.find((check) => check.id === 'hero-still-match');
    assert.equal(hero?.ok, true, hero?.detail);
    assert.ok((hero?.measured ?? 0) >= 0.98, hero?.detail);
    assert.deepEqual(hero?.frames, []);
  });

  it('refuses --still without --still-frame with a usage error', async () => {
    const run = await cli(['qa', '--video', clean, '--still', clean], dataDir);
    assert.equal(run.exitCode, 2);
    assert.equal(run.result.errors[0]?.code, 'usage');
    assert.match(run.result.errors[0]?.message ?? '', /--still needs --still-frame/);
  });

  it('refuses to run without --video', async () => {
    const run = await cli(['qa'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.equal(run.result.errors[0]?.code, 'usage');
    assert.match(run.result.errors[0]?.message ?? '', /Missing --video/);
  });

  it('reports a missing video file as a data-file error', async () => {
    const run = await cli(['qa', '--video', join(dataDir, 'missing.mp4')], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'data-file');
  });
});

describe('qa --job derivations', () => {
  // The fixture's clips: s01 105 frames, a 15-frame dissolve, s02 90, a cut, s03 120: s02 starts at 90, s03 at 180.
  const plan = planFor([{ id: 's01', frames: 105 }, { id: 's02', frames: 90 }, { id: 's03', frames: 120 }], [{ afterClipId: 's01', type: 'dissolve', frames: 15 }]);
  const planPath = 'C:/vf/out/k7f2q9x1/assembly-plan.json';

  it('lists every text element at its clip\'s first frame and at the frame the still gate judged, offset to the delivery timeline', () => {
    const boxes = jobTextBoxes(plan, planShotSpec, planLook, planPath);
    const stillFrame = defaultStillFrame(planShotSpec.shots[2]!, 30);
    assert.ok(stillFrame > 0, 'the fixture title has entered by a later frame than 0');
    assert.deepEqual(boxes, [
      { frame: 180, box: { x: 0.1, y: 0.7, w: 0.4, h: 0.12 }, textColor: '#f4f1ea' },
      { frame: 180 + stillFrame, box: { x: 0.1, y: 0.7, w: 0.4, h: 0.12 }, textColor: '#f4f1ea' },
    ]);
  });

  it('pairs a shot\'s raw still with frame k of its render in the cache, and leaves out a shot without a still or without a manifest', () => {
    const job = mutated(jobExample, (copy) => {
      copy.shots[0] = { ...copy.shots[0]!, stillPath: 'C:/vf/out/k7f2q9x1/stills/s01-r2.png', manifestPath: 'C:/vf/cache/aaaa/manifest.json' };
      copy.shots[1] = { ...copy.shots[1]!, stillPath: 'C:/vf/out/k7f2q9x1/stills/s02-r1.png', manifestPath: null };
    });
    const loaded = { folder: { dir: 'C:/vf/out/k7f2q9x1', briefPath: '', treatmentPath: '', shotSpecPath: '', lookPath: '', jobPath: '' }, job, shotSpec: planShotSpec, look: planLook };
    const { stills, skipped } = jobShotStills(loaded);
    assert.equal(defaultStillFrame(planShotSpec.shots[0]!, 30), 104);
    assert.deepEqual(stills, [{ shotId: 's01', path: 'C:/vf/out/k7f2q9x1/stills/s01-r2.raw.png', framePath: join('C:/vf/cache/aaaa', 'frames', 'f000104.png'), frame: 104 }]);
    assert.deepEqual(skipped.map((entry) => entry.shotId), ['s02', 's03']);
    assert.match(skipped[0]?.reason ?? '', /records no render manifest/);
    assert.match(skipped[1]?.reason ?? '', /records no still/);
  });

  it('reports a plan without a clip for one of the shots as a data-file error naming assemble', () => {
    const short = planFor([{ id: 's01', frames: 105 }, { id: 's02', frames: 90 }]);
    assert.throws(() => jobTextBoxes(short, planShotSpec, planLook, planPath), (error: unknown) => error instanceof Error && /no clip for shot "s03"/.test(error.message));
  });

  it('names the job\'s report <job>/qa/<jobId>.qa.json', () => {
    assert.equal(jobReportPath('C:\\j', 'k7f2q9x1'), join('C:\\j', 'qa', 'k7f2q9x1.qa.json'));
  });
});

describe('qa --job over an assembled job', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  let dataDir = '';
  let jobDir = '';
  let jobId = '';
  before(async () => {
    if (ffmpeg === undefined) return;
    dir = mkdtempSync(join(tmpdir(), 'vf-cli-qa-job-'));
    dataDir = join(dir, 'data');
    const documents = writeFixtureDocuments(dir);
    const planned = await cli(['plan', '--brief', documents.brief, '--treatment', documents.treatment, '--shot-spec', documents.shotSpec, '--look', documents.look], dataDir);
    assert.equal(planned.exitCode, 0, planned.stderr);
    jobDir = (planned.result.data as { readonly jobDir: string }).jobDir;
    jobId = (readJsonFile(join(jobDir, 'job.json')) as Job).id;
  });
  after(() => { if (dir.length > 0) rmSync(dir, { recursive: true, force: true }); });

  it('refuses --job with --video, and a job that has not been assembled with job-not-assembled naming assemble', async () => {
    const both = await cli(['qa', '--job', jobDir, '--video', 'film.mp4'], dataDir);
    assert.equal(both.exitCode, 2);
    assert.match(both.result.errors[0]?.message ?? '', /--video does not go with --job/);
    const unassembled = await cli(['qa', '--job', jobDir], dataDir);
    assert.equal(unassembled.exitCode, 1);
    assert.equal(unassembled.result.errors[0]?.code, 'job-not-assembled');
    assert.match(unassembled.result.errors[0]?.message ?? '', /its status is planned/);
    assert.match(unassembled.result.errors[0]?.hint ?? '', /Run assemble first/);
    // A job assemble left mid-way is refused whatever delivery file is still in the folder.
    const planned = readJsonFile(join(jobDir, 'job.json')) as Job;
    const stale = join(jobDir, 'stale.mp4');
    writeFileSync(stale, '', 'utf8');
    writeJsonAtomic(join(jobDir, 'job.json'), { ...planned, status: 'assembling', deliverablePath: stale });
    const cut = await cli(['qa', '--job', jobDir], dataDir);
    assert.equal(cut.exitCode, 1);
    assert.equal(cut.result.errors[0]?.code, 'job-not-assembled');
    assert.match(cut.result.errors[0]?.message ?? '', /the last assemble did not finish/);
    writeJsonAtomic(join(jobDir, 'job.json'), planned);
  });

  it('measures the delivery against the plan, every text box and every shot\'s still, writes <job>/qa/<jobId>.qa.json and delivers the job', async () => {
    if (ffmpeg === undefined) return;
    await renderFixtureJob(jobDir, dataDir, ffmpeg.path);
    const assembled = await cli(['assemble', '--job', jobDir], dataDir);
    assert.equal(assembled.exitCode, 0, `${JSON.stringify(assembled.result.errors)}\n${assembled.stderr}`);
    const run = await cli(['qa', '--job', jobDir], dataDir);
    assert.equal(run.exitCode, 0, `${JSON.stringify(run.result.errors)}\n${run.stderr}`);
    const data = run.result.data as QaData;
    assert.equal(data.passed, true, run.stderr);
    assert.equal(data.reportPath, join(jobDir, 'qa', `${jobId}.qa.json`));
    assert.deepEqual(run.result.evidence, [data.reportPath]);
    const report = readJsonFile(data.reportPath) as QaReport;
    validateDocument('qa-report', report);
    assert.equal(report.subject.path, join(jobDir, `${jobId}.mp4`));
    // Every shot has a still and a manifest, so three hero comparisons run, each against the render's own frame rather than the delivery.
    assert.deepEqual(report.checks.map((check) => check.id), ['dimensions', 'fps', 'duration', 'black-frames', 'frozen-frames', 'pops', 'exposure-drift', 'text-contrast', 'loudness', 'true-peak', 'hero-still-match', 'hero-still-match', 'hero-still-match']);
    assert.doesNotMatch(run.stderr, /has no hero comparison/);
    const uncompared = report.checks.filter((check) => check.id === 'hero-still-match' && check.measured === null);
    assert.equal(uncompared.length, 0);
    const duration = report.checks.find((check) => check.id === 'duration');
    assert.deepEqual([duration?.ok, duration?.measured, duration?.threshold], [true, 300, 300]);
    const contrast = report.checks.find((check) => check.id === 'text-contrast');
    assert.equal(contrast?.ok, true, contrast?.detail);
    assert.match(contrast?.detail ?? '', /all 2 text box\(es\)/);
    const heroes = report.checks.filter((check) => check.id === 'hero-still-match' && check.measured !== null);
    for (const hero of heroes) assert.equal(hero.ok, true, hero.detail);
    assert.deepEqual(heroes.map((hero) => /matches (s0\d-r1\.raw\.png)/.exec(hero.detail)?.[1]), ['s01-r1.raw.png', 's02-r1.raw.png', 's03-r1.raw.png']);
    assert.equal((readJsonFile(join(jobDir, 'job.json')) as Job).status, 'delivered');
  });

  it('fails the job with the failing checks in the message when a still no longer matches its frame', async () => {
    // A raw still of the wrong colour stands in for a shot whose render drifted from what was approved.
    writeSolidPng(fixtureStillPath(jobDir, 's02').replace(/\.png$/, '.raw.png'), renderedJobSize.width, renderedJobSize.height, [200, 40, 40]);
    const run = await cli(['qa', '--job', jobDir], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'qa-failed');
    assert.match(run.result.errors[0]?.message ?? '', /hero-still-match/);
    assert.doesNotMatch(run.result.errors[0]?.message ?? '', /text-contrast/);
    const job = readJsonFile(join(jobDir, 'job.json')) as Job;
    assert.equal(job.status, 'failed');
    assert.equal(job.deliverablePath, join(jobDir, `${jobId}.mp4`));
    const report = readJsonFile(run.result.evidence[0] ?? '') as QaReport;
    assert.equal(report.checks.filter((check) => check.id === 'hero-still-match' && !check.ok).length, 1);
    // --no-fail writes the same verdict on the job and exits 0 with the failed ids in the payload.
    const lenient = await cli(['qa', '--job', jobDir, '--no-fail'], dataDir);
    assert.equal(lenient.exitCode, 0, lenient.stderr);
    assert.deepEqual((lenient.result.data as QaData).failed, ['hero-still-match']);
    writeJsonAtomic(join(jobDir, 'job.json'), { ...job, status: 'qa' });
  });
});
