import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CliResult } from '../../src/cli/result.ts';
import type { QaData } from '../../src/cli/commands/qa.ts';
import { readJsonFile } from '../../src/fs/atomic-json.ts';
import { extractFrame } from '../../src/qa/frame-extract.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { QaReport } from '../../src/shared/contracts/qa-report.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { ffmpegPath, makeBlackFreezeClip, makeBoxesClip, makeCleanClip, never, planFor, runner } from '../qa/synthetic-clips.ts';

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
