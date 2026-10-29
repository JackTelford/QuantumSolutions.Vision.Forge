import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { SchemaValidationError } from '../../src/errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { buildJob, carriedOverShot, deepestJobPath, jobFileNames, jobFolder, jobId, keptShotCount, readPreviousJob, writeJobFolder } from '../../src/plan/job.ts';
import type { JobInputs } from '../../src/plan/job.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import { hex64, mutated } from '../schema/documents/examples.ts';
import { planBrief, planDocuments, planLook, planShotSpec, planTreatment } from './fixtures.ts';

const createdAt = '2026-10-29T10:00:00.000Z';

function inputs(outDir: string, previous: Job | undefined, keys: readonly string[] = [hex64('a'), hex64('b'), hex64('c')]): JobInputs {
  return { id: 'ab12cd34', documents: planDocuments(), keys, folder: jobFolder(outDir, 'ab12cd34'), dataDir: join(outDir, 'data'), createdAt, previous };
}

describe('jobId', () => {
  it('is eight lowercase hex characters and the same for the same documents', async () => {
    const first = await jobId(planBrief, planTreatment, planShotSpec, planLook);
    const second = await jobId(structuredClone(planBrief), structuredClone(planTreatment), structuredClone(planShotSpec), structuredClone(planLook));
    assert.match(first, /^[a-z0-9]{8}$/);
    assert.equal(first, second);
  });

  it('changes when any of the four documents changes', async () => {
    const original = await jobId(planBrief, planTreatment, planShotSpec, planLook);
    assert.notEqual(await jobId(mutated(planBrief, (copy) => { copy.title = 'Other'; }), planTreatment, planShotSpec, planLook), original);
    assert.notEqual(await jobId(planBrief, planTreatment, planShotSpec, mutated(planLook, (copy) => { copy.exposureEv = 0; })), original);
  });
});

describe('jobFolder', () => {
  it('names the folder after the id and the five files inside it', () => {
    const folder = jobFolder('C:\\vf\\out', 'ab12cd34');
    assert.equal(folder.dir, join('C:\\vf\\out', 'ab12cd34'));
    assert.equal(folder.briefPath, join(folder.dir, jobFileNames.brief));
    assert.equal(folder.lookPath, join(folder.dir, 'look-bible.json'));
    assert.equal(folder.jobPath, join(folder.dir, 'job.json'));
  });

  it('reserves room beyond the longest document path for the still gate files', () => {
    const folder = jobFolder('C:\\vf\\out', 'ab12cd34');
    const deepest = deepestJobPath(folder, planShotSpec);
    assert.equal(deepest.path, folder.lookPath);
    assert.equal(deepest.reserve, join(folder.dir, 'stills', 's01-r1.png').length - folder.lookPath.length);
  });
});

describe('buildJob', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-job-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('builds a planned job with every shot pending that the job schema accepts', () => {
    const job = buildJob(inputs(dir, undefined));
    validateDocument('job', job);
    assert.equal(job.id, 'ab12cd34');
    assert.equal(job.status, 'planned');
    assert.equal(job.createdAt, createdAt);
    assert.equal(job.outDir, join(dir, 'ab12cd34'));
    assert.equal(job.dataDir, join(dir, 'data'));
    assert.equal(job.deliverablePath, null);
    assert.deepEqual(job.shots, [
      { id: 's01', key: hex64('a'), status: 'pending', manifestPath: null, stillPath: null, rounds: 0 },
      { id: 's02', key: hex64('b'), status: 'pending', manifestPath: null, stillPath: null, rounds: 0 },
      { id: 's03', key: hex64('c'), status: 'pending', manifestPath: null, stillPath: null, rounds: 0 },
    ]);
  });

  it('keeps the status, rounds, manifest and still of a shot whose key is unchanged, and resets one whose key changed', () => {
    const previous = buildJob(inputs(dir, undefined));
    const edited: Job = {
      ...previous,
      shots: [
        { ...previous.shots[0]!, status: 'still-approved', rounds: 2, stillPath: join(dir, 'stills', 's01-r2.png'), manifestPath: join(dir, 'cache', 'manifest.json') },
        { ...previous.shots[1]!, status: 'still-rendered', rounds: 1, stillPath: join(dir, 'stills', 's02-r1.png') },
        previous.shots[2]!,
      ],
    };
    const rerun = buildJob(inputs(dir, edited, [hex64('a'), hex64('d'), hex64('c')]));
    assert.deepEqual(rerun.shots[0], edited.shots[0]);
    assert.deepEqual(rerun.shots[1], { id: 's02', key: hex64('d'), status: 'pending', manifestPath: null, stillPath: null, rounds: 0 });
    assert.deepEqual(rerun.shots[2], edited.shots[2]);
    assert.equal(rerun.status, 'planned');
    assert.equal(keptShotCount(edited, rerun), 2);
    assert.equal(keptShotCount(undefined, rerun), 0);
    assert.equal(carriedOverShot(edited, 's02', hex64('b'))?.status, 'still-rendered');
  });

  it('writes the four copies and job.json atomically, and reads job.json back as the previous job', () => {
    const job = buildJob(inputs(dir, undefined));
    const folder = jobFolder(dir, 'ab12cd34');
    assert.equal(readPreviousJob(folder), undefined);
    writeJobFolder(folder, planDocuments(), job);
    for (const path of [folder.briefPath, folder.treatmentPath, folder.shotSpecPath, folder.lookPath, folder.jobPath]) assert.ok(existsSync(path), path);
    assert.deepEqual(readJsonFile(folder.shotSpecPath), planShotSpec);
    assert.deepEqual(readPreviousJob(folder), job);
  });
});

describe('readPreviousJob', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-previous-job-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('rejects a corrupt job.json with a schema-validation error whose hint names the file', () => {
    const folder = jobFolder(dir, 'corrupt1');
    writeJsonAtomic(folder.jobPath, { kind: 'job', version: 1, id: 'ab12cd34' });
    assert.throws(() => readPreviousJob(folder), (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.equal(error.kind, 'job');
      assert.match(error.message, /The job document is invalid: \$: must have required property/);
      assert.ok(error.hint.includes(folder.jobPath), error.hint);
      assert.match(error.hint, /fix it or delete it to plan afresh/);
      return true;
    });
  });

  it('rejects a job.json the schema accepts but whose shot has more review rounds than the cap, naming the file', () => {
    const folder = jobFolder(dir, 'rounds4');
    const job = buildJob(inputs(dir, undefined));
    writeJsonAtomic(folder.jobPath, { ...job, shots: [{ ...job.shots[0]!, rounds: 4 }, ...job.shots.slice(1)] });
    assert.throws(() => readPreviousJob(folder), (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.equal(error.code, 'schema-validation');
      assert.match(error.message, /shot "s01" has 4 review rounds, over the cap of 3/);
      assert.ok(error.hint.includes(folder.jobPath), error.hint);
      return true;
    });
  });
});
