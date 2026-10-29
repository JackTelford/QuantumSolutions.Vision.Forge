import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PlanData } from '../../src/cli/commands/plan.ts';
import { describeShot, describeTotals } from '../../src/cli/commands/plan.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import { mutated } from '../schema/documents/examples.ts';
import { planBrief, planDocuments, planLook, planShotSpec, planTreatment } from '../plan/fixtures.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function plan(args: readonly string[], dataDir: string, cwd = repoRoot): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, 'plan', ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd, timeoutMs: 60_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

/** The four options for documents written under a folder; a missing name is left out. */
function options(dir: string, names: Partial<Record<'brief' | 'treatment' | 'shot-spec' | 'look', string>>): readonly string[] {
  return Object.entries(names).flatMap(([option, name]) => [`--${option}`, join(dir, name)]);
}

describe('plan command helpers', () => {
  it('describes a shot and the totals on one line each', () => {
    assert.equal(describeShot(planShotSpec.shots[0]!), 's01  three  MCU  85mm f/2.8  push-in  105 f');
    assert.equal(describeTotals(planDocuments()), '3 shots, 300 frames, 10.0 s; brief asks 10 s');
  });
});

describe('plan command', () => {
  let dir = '';
  let dataDir = '';
  const all = { brief: 'brief.json', treatment: 'treatment.json', 'shot-spec': 'shot-spec.json', look: 'look.json' } as const;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-plan-'));
    dataDir = join(dir, 'data');
    writeJsonAtomic(join(dir, 'brief.json'), planBrief);
    writeJsonAtomic(join(dir, 'treatment.json'), planTreatment);
    writeJsonAtomic(join(dir, 'shot-spec.json'), planShotSpec);
    writeJsonAtomic(join(dir, 'look.json'), planLook);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('exits 0, writes the job folder with a valid job.json and reports every shot with its key and start frame', async () => {
    const run = await plan(options(dir, all), dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.equal(run.result.ok, true);
    assert.equal(run.result.command, 'plan');
    const data = run.result.data as PlanData;
    assert.match(data.jobId, /^[a-z0-9]{8}$/);
    assert.equal(data.jobDir, join(dataDir, 'out', data.jobId));
    assert.equal(data.jobPath, join(data.jobDir, 'job.json'));
    assert.equal(data.status, 'planned');
    assert.deepEqual(data.shots.map((shot) => [shot.id, shot.lane, shot.durationFrames, shot.startFrame]), [['s01', 'three', 105, 0], ['s02', 'three', 90, 90], ['s03', 'html', 120, 180]]);
    for (const shot of data.shots) assert.match(shot.key, /^[0-9a-f]{64}$/);
    assert.equal(data.totalFrames, 300);
    assert.equal(data.durationSeconds, 10);
    assert.equal(data.briefDurationSeconds, 10);
    assert.deepEqual(data.warnings, []);
    assert.deepEqual(run.result.artifacts, []);
    assert.deepEqual(run.result.evidence, [data.jobPath]);
    for (const name of ['brief.json', 'treatment.json', 'shot-spec.json', 'look-bible.json', 'job.json']) assert.ok(existsSync(join(data.jobDir, name)), name);
    const job = readJsonFile(data.jobPath) as Job;
    validateDocument('job', job);
    assert.equal(job.id, data.jobId);
    assert.equal(job.briefPath, join(data.jobDir, 'brief.json'));
    assert.equal(job.lookPath, join(data.jobDir, 'look-bible.json'));
    assert.equal(job.outDir, data.jobDir);
    assert.equal(job.dataDir, dataDir);
    assert.deepEqual(job.shots.map((shot) => [shot.id, shot.key, shot.status, shot.rounds]), data.shots.map((shot) => [shot.id, shot.key, 'pending', 0]));
    assert.deepEqual(readJsonFile(job.shotSpecPath), planShotSpec);
    assert.match(run.stderr, /^s01 {2}three {2}MCU {2}85mm f\/2\.8 {2}push-in {2}105 f$/m);
    assert.match(run.stderr, /^s03 {2}html {2}MCU {2}85mm f\/2\.8 {2}static-hold {2}120 f$/m);
    assert.match(run.stderr, /^3 shots, 300 frames, 10\.0 s; brief asks 10 s$/m);
    assert.doesNotMatch(run.stderr, /warning:/);
  });

  it('resolves relative paths against the working directory and plans into the same folder for the same documents', async () => {
    const first = await plan(options(dir, all), dataDir);
    const relative = await plan(['--brief', 'brief.json', '--treatment', 'treatment.json', '--shot-spec', 'shot-spec.json', '--look', 'look.json'], dataDir, dir);
    assert.equal(relative.exitCode, 0, relative.stderr);
    assert.equal((relative.result.data as PlanData).jobId, (first.result.data as PlanData).jobId);
  });

  it('keeps a shot marked still-approved in a hand-edited job.json on a rerun and says how many were kept', async () => {
    const first = await plan(options(dir, all), dataDir);
    assert.equal(first.exitCode, 0, first.stderr);
    const jobPath = (first.result.data as PlanData).jobPath;
    const job = readJsonFile(jobPath) as Job;
    const approved = { ...job.shots[0]!, status: 'still-approved' as const, rounds: 1, stillPath: join(dirname(jobPath), 'stills', 's01-r1.png') };
    writeJsonAtomic(jobPath, { ...job, status: 'stills', shots: [approved, ...job.shots.slice(1)] });
    const rerun = await plan(options(dir, all), dataDir);
    assert.equal(rerun.exitCode, 0, rerun.stderr);
    assert.match(rerun.stderr, /job\.json exists; 3 of 3 shots keep their status/);
    const kept = readJsonFile(jobPath) as Job;
    assert.deepEqual(kept.shots[0], approved);
    assert.equal(kept.shots[1]?.status, 'pending');
    assert.equal(kept.status, 'planned');
  });

  it('logs the cross-document warnings and returns them in the payload', async () => {
    const warnDir = join(dir, 'warn');
    writeJsonAtomic(join(warnDir, 'brief.json'), planBrief);
    writeJsonAtomic(join(warnDir, 'treatment.json'), mutated(planTreatment, (copy) => { copy.narrationFirst = true; }));
    writeJsonAtomic(join(warnDir, 'shot-spec.json'), planShotSpec);
    writeJsonAtomic(join(warnDir, 'look.json'), planLook);
    const run = await plan(options(warnDir, all), dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as PlanData;
    assert.equal(data.warnings.length, 1);
    assert.match(data.warnings[0] ?? '', /narrationFirst/);
    assert.match(run.stderr, /^warning: the treatment sets narrationFirst/m);
  });

  it('exits 1 with code schema-validation naming the document kind for a broken shot spec, without writing a folder', async () => {
    writeJsonAtomic(join(dir, 'odd-spec.json'), mutated(planShotSpec, (copy) => { copy.width = 1921; }));
    const outDir = join(dataDir, 'out');
    const foldersBefore = existsSync(outDir) ? readdirSync(outDir) : [];
    const run = await plan(options(dir, { ...all, 'shot-spec': 'odd-spec.json' }), dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.errors[0]?.code, 'schema-validation');
    assert.match(run.result.errors[0]?.message ?? '', /The shot-spec document is invalid: shot-spec: width and height must be even for yuv420p; got 1921x1080/);
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/);
    assert.deepEqual(existsSync(outDir) ? readdirSync(outDir) : [], foldersBefore);
  });

  it('names the option and the file when a document has no kind', async () => {
    writeJsonAtomic(join(dir, 'no-kind.json'), { hello: 1 });
    const run = await plan(options(dir, { ...all, look: 'no-kind.json' }), dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'schema-validation');
    const message = run.result.errors[0]?.message ?? '';
    assert.match(message, /The look-bible document is invalid: look-bible: --look \(.*no-kind\.json\): \/kind: must be a string naming the document kind/);
    assert.ok(message.includes(join(dir, 'no-kind.json')), message);
  });

  it('collects the problems of every document and names the option that got the wrong kind', async () => {
    writeJsonAtomic(join(dir, 'bad-brief.json'), mutated(planBrief, (copy) => { (copy as { width: unknown }).width = 'wide'; }));
    const run = await plan(options(dir, { ...all, brief: 'bad-brief.json', look: 'treatment.json' }), dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'schema-validation');
    assert.match(run.result.errors[0]?.message ?? '', /The brief and look-bible document is invalid: brief: \/width: must be integer; look-bible: --look names a treatment document \(.*treatment\.json\), not a look-bible/);
  });

  it('exits 1 with code cross-document when the documents do not agree', async () => {
    writeJsonAtomic(join(dir, 'other-treatment.json'), mutated(planTreatment, (copy) => { copy.briefId = 'other'; }));
    const run = await plan(options(dir, { ...all, treatment: 'other-treatment.json' }), dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'cross-document');
    assert.match(run.result.errors[0]?.message ?? '', /The four documents do not agree: treatment "obsidian-bottle-t1" answers brief "other"/);
    assert.match(run.result.errors[0]?.hint ?? '', /src\/plan\/cross-checks\.ts/);
  });

  it('exits 1 with code cross-document naming the shot when a text box sits on the subject', async () => {
    writeJsonAtomic(join(dir, 'overlap-shot-spec.json'), mutated(planShotSpec, (copy) => {
      const shot = copy.shots[0];
      if (shot === undefined) throw new Error('fixture has no shot');
      shot.text = [{ id: 't-over', role: 'title', content: 'Over the subject', box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, animation: 'none', staggerMs: 0, inFrame: 0, outFrame: null }];
    }));
    const run = await plan(options(dir, { ...all, 'shot-spec': 'overlap-shot-spec.json' }), dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'cross-document');
    assert.match(run.result.errors[0]?.message ?? '', /shot "s01": .*overlap/i);
  });

  it('exits 2 with a usage error naming the option when --look is missing', async () => {
    const run = await plan(options(dir, { brief: 'brief.json', treatment: 'treatment.json', 'shot-spec': 'shot-spec.json' }), dataDir);
    assert.equal(run.exitCode, 2);
    assert.equal(run.result.errors[0]?.code, 'usage');
    assert.match(run.result.errors[0]?.message ?? '', /Missing --look/);
  });

  it('exits 1 with code data-file when a document file does not exist', async () => {
    const run = await plan(options(dir, { ...all, brief: 'missing.json' }), dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'data-file');
    assert.match(run.result.errors[0]?.message ?? '', /missing\.json: the file does not exist/);
  });
});
