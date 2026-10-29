import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DataFileError, SchemaValidationError, UsageError } from '../../src/errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { buildJob, jobFolder, writeJobFolder } from '../../src/plan/job.ts';
import type { JobFolder } from '../../src/plan/job.ts';
import { emptyFingerprint, shotKey } from '../../src/plan/shot-key.ts';
import { findJobShot, findShot, jobFolderOf, loadJob, pinRenderProfile, saveJob, updateShot, withRenderProfile } from '../../src/render/job-state.ts';
import type { Job } from '../../src/shared/contracts/job.ts';
import type { RenderProfile, ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { hex64 } from '../schema/documents/examples.ts';
import { planDocuments } from '../plan/fixtures.ts';

const software: RenderProfile = { engine: 'chromium', backend: 'swiftshader-webgl', renderer: 'software' };

describe('job state', () => {
  let dir = '';
  let folder: JobFolder;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-job-state-'));
    folder = jobFolder(join(dir, 'out'), 'ab12cd34');
    const documents = planDocuments();
    const job = buildJob({ id: 'ab12cd34', documents, keys: [hex64('a'), hex64('b'), hex64('c')], folder, dataDir: join(dir, 'data'), createdAt: '2026-10-29T10:00:00.000Z', previous: undefined });
    writeJobFolder(folder, documents, job);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads the job from its folder or from its job.json, with the shot spec and look copies beside it', () => {
    const fromFolder = loadJob(folder.dir);
    const fromFile = loadJob(folder.jobPath);
    assert.deepEqual(fromFolder, fromFile);
    assert.equal(fromFolder.folder.dir, folder.dir);
    assert.equal(fromFolder.job.id, 'ab12cd34');
    assert.equal(fromFolder.shotSpec.shots.length, 3);
    assert.equal(fromFolder.look.id, 'obsidian');
    assert.equal(jobFolderOf(folder.jobPath).jobPath, folder.jobPath);
  });

  it('names a missing folder or a folder without job.json', () => {
    assert.throws(() => loadJob(join(dir, 'nowhere')), (error: unknown) => error instanceof DataFileError && /does not exist/.test(error.message));
    const empty = jobFolder(join(dir, 'out'), 'empty123');
    writeJsonAtomic(join(empty.dir, 'placeholder.json'), {});
    assert.throws(() => loadJob(empty.dir), (error: unknown) => error instanceof DataFileError && error.path === empty.jobPath && /Run plan first/.test(error.hint));
  });

  it('rejects a job folder whose shot spec copy no longer validates, naming the file', () => {
    const broken = jobFolder(join(dir, 'out'), 'broken12');
    const documents = planDocuments();
    const job = buildJob({ id: 'broken12', documents, keys: [hex64('a'), hex64('b'), hex64('c')], folder: broken, dataDir: join(dir, 'data'), createdAt: '2026-10-29T10:00:00.000Z', previous: undefined });
    writeJobFolder(broken, documents, job);
    writeJsonAtomic(broken.shotSpecPath, { ...documents.shotSpec, width: 1921 });
    assert.throws(() => loadJob(broken.dir), (error: unknown) => error instanceof SchemaValidationError && error.kind === 'shot-spec' && error.hint.includes(broken.shotSpecPath));
  });

  it('finds shots by id and names every id when one is absent', () => {
    const { shotSpec, job } = loadJob(folder.dir);
    assert.equal(findShot(shotSpec, 's03').lane, 'html');
    assert.throws(() => findShot(shotSpec, 's99'), (error: unknown) => error instanceof UsageError && /no shot "s99"/.test(error.message) && /s01, s02, s03/.test(error.hint));
    assert.equal(findJobShot(job, 's02').key, hex64('b'));
    assert.throws(() => findJobShot(job, 's99'), /no entry for shot "s99"/);
  });

  it('updates one shot entry without touching the others and saves a valid job', () => {
    const { job } = loadJob(folder.dir);
    const updated = updateShot(job, 's03', { status: 'still-rendered', stillPath: join(folder.dir, 'stills', 's03-r1.png'), rounds: 1 });
    assert.equal(updated.shots[2]?.status, 'still-rendered');
    assert.equal(updated.shots[2]?.rounds, 1);
    assert.equal(updated.shots[0]?.status, 'pending');
    assert.equal(job.shots[2]?.status, 'pending');
    saveJob(folder, { ...updated, status: 'stills' });
    assert.equal((readJsonFile(folder.jobPath) as Job).status, 'stills');
    assert.throws(() => saveJob(folder, updateShot(job, 's03', { rounds: 9 })), SchemaValidationError);
    assert.throws(() => updateShot(job, 's99', { rounds: 1 }), /no entry for shot "s99"/);
  });

  it('pins the render profile into the folder\'s shot spec and gives the shot a new key', async () => {
    const { shotSpec, look } = loadJob(folder.dir);
    const fingerprint = { ...emptyFingerprint, laneCodeHash: hex64('e') };
    const before = await shotKey(findShot(shotSpec, 's03'), look, fingerprint);
    const pinned = await pinRenderProfile(folder, shotSpec, 's03', software, look, fingerprint);
    assert.deepEqual(pinned.shot.renderProfile, software);
    assert.notEqual(pinned.key, before);
    assert.equal(pinned.key, await shotKey(pinned.shot, look, fingerprint));
    const onDisk = readJsonFile(folder.shotSpecPath) as ShotSpec;
    assert.deepEqual(onDisk.shots[2]?.renderProfile, software);
    assert.equal(onDisk.shots[1]?.renderProfile, null);
    assert.equal(shotSpec.shots[2]?.renderProfile, null, 'the spec given in is not mutated');
    // Pinning the same profile again changes nothing: the key is a function of the shot, not of the pinning.
    const again = await pinRenderProfile(folder, onDisk, 's03', software, look, fingerprint);
    assert.equal(again.key, pinned.key);
    assert.deepEqual(withRenderProfile(shotSpec, 's01', software).shots[0]?.renderProfile, software);
  });
});
