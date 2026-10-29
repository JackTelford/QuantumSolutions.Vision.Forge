/**
 * Keeps the render profile the still gate pinned across a replan. The gate
 * writes the winning profile into the job folder's copy of the shot spec
 * (ADR 0004 decision 6) and the profile is part of the shot key (ADR 0006
 * decision 8), while the owner's own documents keep renderProfile null. A
 * plan run over the same folder therefore reads the previous copy and, for
 * every shot that is unchanged apart from the profile, carries the pinned
 * profile into the new copy, so the key, the status and the still survive;
 * a shot the documents changed is re-keyed and goes back through the gate.
 */
import { existsSync } from 'node:fs';
import { readJsonFile } from '../fs/atomic-json.ts';
import { validateDocument } from '../schema/validator.ts';
import type { RenderProfile, Shot, ShotSpec } from '../shared/contracts/shot-spec.ts';
import { canonicalJson } from '../shared/canonical-json.ts';
import type { JobFolder } from './job.ts';

/** What carrying produced: the spec to plan with and the shots whose profile was kept. */
export interface CarriedProfiles {
  readonly shotSpec: ShotSpec;
  readonly carriedShotIds: readonly string[];
}

/** True when two shots differ in nothing but their render profile. */
export function sameShotExceptProfile(a: Shot, b: Shot): boolean {
  return canonicalJson({ ...a, renderProfile: null }) === canonicalJson({ ...b, renderProfile: null });
}

/** The previous copy of the shot spec in a job folder, when it exists and validates; undefined otherwise (a broken copy is replaced, never trusted). */
export function readPreviousShotSpec(folder: JobFolder): ShotSpec | undefined {
  if (!existsSync(folder.shotSpecPath)) return undefined;
  const document = readJsonFile(folder.shotSpecPath);
  try {
    validateDocument('shot-spec', document);
  } catch {
    return undefined;
  }
  return document as ShotSpec;
}

/** The profile a shot keeps from the previous copy: the previous shot's, when it had one and the shot is otherwise unchanged and the new shot pins none. */
export function carriedProfile(shot: Shot, previous: ShotSpec | undefined): RenderProfile | null {
  if (shot.renderProfile !== null || previous === undefined) return shot.renderProfile;
  const before = previous.shots.find((candidate) => candidate.id === shot.id);
  if (before === undefined || before.renderProfile === null || !sameShotExceptProfile(shot, before)) return shot.renderProfile;
  return { ...before.renderProfile };
}

/** The spec with every carried profile applied, and the ids of the shots that kept one. */
export function carryPinnedProfiles(folder: JobFolder, shotSpec: ShotSpec): CarriedProfiles {
  const previous = readPreviousShotSpec(folder);
  const carriedShotIds: string[] = [];
  const shots = shotSpec.shots.map((shot) => {
    const profile = carriedProfile(shot, previous);
    if (profile === shot.renderProfile) return shot;
    carriedShotIds.push(shot.id);
    return { ...shot, renderProfile: profile };
  });
  return { shotSpec: { ...shotSpec, shots }, carriedShotIds };
}
