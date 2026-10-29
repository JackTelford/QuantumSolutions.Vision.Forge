/**
 * The job folder as the still and render commands see it: the job and the
 * copies of the shot spec and the look bible the plan command wrote beside
 * it (the copies, not the paths job.json records, so a moved folder still
 * works), each validated the way plan validated it. Updates return new
 * documents; nothing here mutates what it was given.
 *
 * The one write with a reason of its own is pinRenderProfile: the still
 * gate records how the shot was rendered in the shot spec (ADR 0004
 * decision 6) and the profile is part of the shot key (ADR 0006 decision
 * 8). The key the job records from the gate on is the first computed with
 * both the lane code hash and the profile (plan computes its keys without
 * either, see src/cli/commands/plan.ts), and it is the key render looks the
 * cache up by. render refuses to switch renderer afterwards.
 */
import { statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DataFileError, SchemaValidationError, UsageError } from '../errors/vision-forge-error.ts';
import { writeJsonAtomic } from '../fs/atomic-json.ts';
import { checkDocument } from '../plan/documents.ts';
import { jobFileNames, jobFolder, readPreviousJob } from '../plan/job.ts';
import type { JobFolder } from '../plan/job.ts';
import { shotKey } from '../plan/shot-key.ts';
import type { RenderFingerprint } from '../plan/shot-key.ts';
import { runSemanticChecks } from '../schema/checks/index.ts';
import { validateDocument } from '../schema/validator.ts';
import type { Job, JobShot } from '../shared/contracts/job.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { RenderProfile, Shot, ShotSpec } from '../shared/contracts/shot-spec.ts';

/** A job folder with its three documents read and validated. */
export interface LoadedJob {
  readonly folder: JobFolder;
  readonly job: Job;
  readonly shotSpec: ShotSpec;
  readonly look: LookBible;
}

/** The job folder a --job argument names: the folder itself, or its job.json. */
export function jobFolderOf(jobArg: string): JobFolder {
  let dir = jobArg;
  try {
    if (!statSync(jobArg).isDirectory()) dir = dirname(jobArg);
  } catch {
    throw new DataFileError(jobArg, 'the path does not exist', 'Pass --job <folder> or --job <folder>/job.json as the plan command printed it.');
  }
  return jobFolder(dirname(dir), basename(dir));
}

/** Reads one of the document copies in the folder and checks it as plan did; throws SchemaValidationError naming the file. */
function loadCopy<T>(option: 'shot-spec' | 'look', kind: string, path: string, dataDir: string): T {
  const check = checkDocument(option, kind, path, dataDir);
  if (check.problems.length > 0) {
    throw new SchemaValidationError(kind, check.problems, `Fix ${path} or run plan again to rewrite the job folder; the rules are in schemas/ and src/schema/checks/.`);
  }
  return check.document as T;
}

/** Loads a job folder: job.json, then the shot spec and look bible copies beside it. */
export function loadJob(jobArg: string): LoadedJob {
  const folder = jobFolderOf(jobArg);
  const job = readPreviousJob(folder);
  if (job === undefined) throw new DataFileError(folder.jobPath, 'the file does not exist', 'Run plan first; it writes the job folder and job.json.');
  const shotSpec = loadCopy<ShotSpec>('shot-spec', 'shot-spec', folder.shotSpecPath, job.dataDir);
  const look = loadCopy<LookBible>('look', 'look-bible', folder.lookPath, job.dataDir);
  return { folder, job, shotSpec, look };
}

/** The shot of a spec by id; a usage error naming every id when it is absent. */
export function findShot(shotSpec: ShotSpec, shotId: string): Shot {
  const shot = shotSpec.shots.find((candidate) => candidate.id === shotId);
  if (shot === undefined) throw new UsageError(`The job has no shot "${shotId}".`, `Pass --shot with one of: ${shotSpec.shots.map((candidate) => candidate.id).join(', ')}.`);
  return shot;
}

/** The job's entry for a shot; throws when the job has none (the job and the shot spec were written together, so this is a programming error). */
export function findJobShot(job: Job, shotId: string): JobShot {
  const entry = job.shots.find((candidate) => candidate.id === shotId);
  if (entry === undefined) throw new Error(`job.json has no entry for shot "${shotId}".`);
  return entry;
}

/** A new job with the named shot's entry changed. */
export function updateShot(job: Job, shotId: string, changes: Partial<Omit<JobShot, 'id'>>): Job {
  findJobShot(job, shotId);
  return { ...job, shots: job.shots.map((shot) => (shot.id === shotId ? { ...shot, ...changes } : shot)) };
}

/** Validates the job against its schema and its semantic rules (the review round cap among them) and writes job.json atomically. */
export function saveJob(folder: JobFolder, job: Job): void {
  validateDocument('job', job);
  const problems = runSemanticChecks('job', job, { dataDir: undefined });
  if (problems.length > 0) throw new SchemaValidationError('job', problems, `The job would break the rules in src/schema/checks/job.ts; nothing was written to ${folder.jobPath}.`);
  writeJsonAtomic(folder.jobPath, job);
}

/** What pinning a render profile produced: the spec as written and the shot's new key. */
export interface PinnedProfile {
  readonly shotSpec: ShotSpec;
  readonly shot: Shot;
  readonly key: string;
}

/** The spec with the named shot's render profile replaced. */
export function withRenderProfile(shotSpec: ShotSpec, shotId: string, profile: RenderProfile): ShotSpec {
  findShot(shotSpec, shotId);
  return { ...shotSpec, shots: shotSpec.shots.map((shot) => (shot.id === shotId ? { ...shot, renderProfile: { ...profile } } : shot)) };
}

/**
 * Writes the render profile into the shot inside the folder's shot-spec.json
 * and recomputes the shot's key with the profile in it. The fingerprint is
 * the render fingerprint with the lane code hash filled in, so the key the
 * job records from here on is the one render will look the cache up by.
 */
export async function pinRenderProfile(folder: JobFolder, shotSpec: ShotSpec, shotId: string, profile: RenderProfile, look: LookBible, fingerprint: RenderFingerprint): Promise<PinnedProfile> {
  const pinned = withRenderProfile(shotSpec, shotId, profile);
  const shot = findShot(pinned, shotId);
  validateDocument('shot-spec', pinned);
  writeJsonAtomic(join(folder.dir, jobFileNames.shotSpec), pinned);
  return { shotSpec: pinned, shot, key: await shotKey(shot, look, fingerprint) };
}
