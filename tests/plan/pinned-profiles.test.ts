import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { jobFolder } from '../../src/plan/job.ts';
import { carriedProfile, carryPinnedProfiles, readPreviousShotSpec, sameShotExceptProfile } from '../../src/plan/pinned-profiles.ts';
import type { RenderProfile, ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { mutated } from '../schema/documents/examples.ts';
import { planShotSpec } from './fixtures.ts';

const profile: RenderProfile = { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' };

/** The fixture spec with the html shot's profile pinned, as the still gate writes it into the job folder. */
const pinnedSpec: ShotSpec = mutated(planShotSpec, (copy) => {
  const html = copy.shots[2];
  if (html !== undefined) html.renderProfile = { ...profile };
});

describe('sameShotExceptProfile', () => {
  it('ignores the render profile and nothing else', () => {
    const shot = planShotSpec.shots[2]!;
    assert.equal(sameShotExceptProfile(shot, { ...shot, renderProfile: profile }), true);
    assert.equal(sameShotExceptProfile(shot, { ...shot, durationFrames: shot.durationFrames + 1 }), false);
    assert.equal(sameShotExceptProfile(shot, { ...shot, text: [] }), false);
  });
});

describe('carriedProfile', () => {
  it('carries the previous profile into an unchanged shot that pins none', () => {
    const shot = planShotSpec.shots[2]!;
    assert.deepEqual(carriedProfile(shot, pinnedSpec), profile);
  });

  it('keeps a profile the new shot already pins, and pins nothing when the shot changed, is new, or had no profile', () => {
    const shot = planShotSpec.shots[2]!;
    const own: RenderProfile = { engine: 'chromium', backend: 'swiftshader-webgl', renderer: 'software' };
    assert.deepEqual(carriedProfile({ ...shot, renderProfile: own }, pinnedSpec), own);
    assert.equal(carriedProfile({ ...shot, durationFrames: 90 }, pinnedSpec), null);
    assert.equal(carriedProfile({ ...shot, id: 's09' }, pinnedSpec), null);
    assert.equal(carriedProfile(planShotSpec.shots[1]!, pinnedSpec), null, 's02 had no profile in the previous copy');
    assert.deepEqual(carriedProfile(planShotSpec.shots[0]!, pinnedSpec), planShotSpec.shots[0]!.renderProfile, 's01 pins its own profile in the fixture');
    assert.equal(carriedProfile(shot, undefined), null);
  });
});

describe('carryPinnedProfiles over a job folder', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-pinned-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('changes nothing when the folder has no previous copy', () => {
    const folder = jobFolder(dir, 'aaaaaaaa');
    const carried = carryPinnedProfiles(folder, planShotSpec);
    assert.deepEqual(carried.carriedShotIds, []);
    assert.deepEqual(carried.shotSpec, planShotSpec);
  });

  it('carries the pinned profile of every unchanged shot and names them', () => {
    const folder = jobFolder(dir, 'bbbbbbbb');
    writeJsonAtomic(folder.shotSpecPath, pinnedSpec);
    const carried = carryPinnedProfiles(folder, planShotSpec);
    assert.deepEqual(carried.carriedShotIds, ['s03']);
    assert.deepEqual(carried.shotSpec.shots[2]?.renderProfile, profile);
    assert.deepEqual(carried.shotSpec.shots[0]?.renderProfile, planShotSpec.shots[0]!.renderProfile);
    assert.equal(carried.shotSpec.shots[1]?.renderProfile, null);
  });

  it('ignores a previous copy that does not validate', () => {
    const folder = jobFolder(dir, 'cccccccc');
    mkdirSync(folder.dir, { recursive: true });
    writeFileSync(folder.shotSpecPath, '{"kind":"shot-spec"}', 'utf8');
    assert.equal(readPreviousShotSpec(folder), undefined);
    assert.deepEqual(carryPinnedProfiles(folder, planShotSpec).carriedShotIds, []);
  });
});
