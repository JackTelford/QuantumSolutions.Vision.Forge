/**
 * The job document and its folder. The job id is the first eight characters
 * of the content hash of the four approved documents, so the same documents
 * always plan into the same folder; a rerun over that folder keeps the state
 * of every shot whose key has not changed. The folder holds copies of the
 * four documents and job.json, every file written atomically.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SchemaValidationError } from '../errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../fs/atomic-json.ts';
import { assertPathLength } from '../fs/paths.ts';
import { runSemanticChecks } from '../schema/checks/index.ts';
import { validateDocument } from '../schema/validator.ts';
import type { Brief } from '../shared/contracts/brief.ts';
import type { Job, JobShot } from '../shared/contracts/job.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { ShotSpec } from '../shared/contracts/shot-spec.ts';
import type { Treatment } from '../shared/contracts/treatment.ts';
import { contentHash, shortHash } from '../shared/sha256.ts';
import type { PlanDocuments } from './cross-checks.ts';

/** How many characters of the content hash make a job id; job.schema.json fixes the id at eight lowercase letters and digits. */
export const jobIdLength = 8;

/** The file names inside a job folder. */
export const jobFileNames = {
  brief: 'brief.json',
  treatment: 'treatment.json',
  shotSpec: 'shot-spec.json',
  look: 'look-bible.json',
  job: 'job.json',
} as const;

/** The absolute paths of a job folder and the files in it. */
export interface JobFolder {
  /** The folder itself: <outDir>/<jobId>. */
  readonly dir: string;
  readonly briefPath: string;
  readonly treatmentPath: string;
  readonly shotSpecPath: string;
  readonly lookPath: string;
  readonly jobPath: string;
}

/** The job id: the first eight hex characters of the content hash of the four documents together, so equal documents give an equal id. */
export async function jobId(brief: Brief, treatment: Treatment, shotSpec: ShotSpec, look: LookBible): Promise<string> {
  return shortHash(await contentHash({ brief, treatment, shotSpec, look }), jobIdLength);
}

/** The paths of the folder a job id names under the output directory. */
export function jobFolder(outDir: string, id: string): JobFolder {
  const dir = join(outDir, id);
  return {
    dir,
    briefPath: join(dir, jobFileNames.brief),
    treatmentPath: join(dir, jobFileNames.treatment),
    shotSpecPath: join(dir, jobFileNames.shotSpec),
    lookPath: join(dir, jobFileNames.look),
    jobPath: join(dir, jobFileNames.job),
  };
}

/**
 * The longest path the job folder will hold: the longest of the five file
 * paths now, with room reserved for the still gate's files under stills/
 * (named <shot id>-r<round>.png, as job.schema.json's stillPath example
 * shows, with the review round cap of one digit).
 */
export function deepestJobPath(folder: JobFolder, spec: ShotSpec): { readonly path: string; readonly reserve: number } {
  const files = [folder.briefPath, folder.treatmentPath, folder.shotSpecPath, folder.lookPath, folder.jobPath];
  const longestFile = files.reduce((longest, path) => (path.length > longest.length ? path : longest), '');
  const longestShotId = spec.shots.reduce((longest, shot) => (shot.id.length > longest.length ? shot.id : longest), '');
  const stillPath = join(folder.dir, 'stills', `${longestShotId}-r1.png`);
  return { path: longestFile, reserve: Math.max(0, stillPath.length - longestFile.length) };
}

/** What buildJob needs. */
export interface JobInputs {
  /** The job id from jobId(); it names the folder. */
  readonly id: string;
  readonly documents: PlanDocuments;
  /** One shot key per shot of the spec, in spec order. */
  readonly keys: readonly string[];
  readonly folder: JobFolder;
  readonly dataDir: string;
  /** The RFC 3339 timestamp the job records as createdAt. */
  readonly createdAt: string;
  /** The job.json already in the folder, when a previous run wrote one. */
  readonly previous: Job | undefined;
}

/** A fresh, pending shot entry. */
function pendingShot(id: string, key: string): JobShot {
  return { id, key, status: 'pending', manifestPath: null, stillPath: null, rounds: 0 };
}

/** The previous run's entry for a shot when it exists with the same key; a changed key means the shot must be rendered again from scratch. */
export function carriedOverShot(previous: Job | undefined, id: string, key: string): JobShot | undefined {
  return previous?.shots.find((shot) => shot.id === id && shot.key === key);
}

/** How many shots of a job keep a previous run's state: those whose entry is a previous entry with the same id and key. */
export function keptShotCount(previous: Job | undefined, job: Job): number {
  return job.shots.filter((shot) => carriedOverShot(previous, shot.id, shot.key) !== undefined).length;
}

/** The job document: planned, every shot pending unless the previous run already had it under the same key. Pure. */
export function buildJob(inputs: JobInputs): Job {
  const { id, documents, keys, folder, dataDir, createdAt, previous } = inputs;
  const shots = documents.shotSpec.shots.map((shot, index): JobShot => {
    const key = keys[index] ?? '';
    return carriedOverShot(previous, shot.id, key) ?? pendingShot(shot.id, key);
  });
  return {
    kind: 'job',
    version: 1,
    id,
    createdAt,
    briefPath: folder.briefPath,
    treatmentPath: folder.treatmentPath,
    shotSpecPath: folder.shotSpecPath,
    lookPath: folder.lookPath,
    outDir: folder.dir,
    dataDir,
    status: 'planned',
    shots,
    deliverablePath: null,
  };
}

/**
 * The job.json already in the folder, validated against its schema and its
 * semantic rules (unique shot ids, review rounds within the cap), so a
 * carried-over entry never makes plan write a job.json that `validate`
 * rejects; undefined when the folder has none. Every failure names the file
 * so the owner knows what to fix or delete.
 */
export function readPreviousJob(folder: JobFolder): Job | undefined {
  if (!existsSync(folder.jobPath)) return undefined;
  const document = readJsonFile(folder.jobPath);
  try {
    validateDocument('job', document);
  } catch (error: unknown) {
    if (!(error instanceof SchemaValidationError)) throw error;
    throw new SchemaValidationError('job', error.problems, `The previous job at ${folder.jobPath} is invalid; fix it or delete it to plan afresh. The schema is schemas/job.schema.json.`);
  }
  const problems = runSemanticChecks('job', document, { dataDir: undefined });
  if (problems.length > 0) throw new SchemaValidationError('job', problems, `Fix or delete ${folder.jobPath}; the rules are in src/schema/checks/job.ts.`);
  return document as Job;
}

/** Writes the four document copies and job.json into the folder, each atomically, after checking the folder's deepest path fits the Windows limit. */
export function writeJobFolder(folder: JobFolder, documents: PlanDocuments, job: Job): void {
  const deepest = deepestJobPath(folder, documents.shotSpec);
  assertPathLength(deepest.path, deepest.reserve);
  writeJsonAtomic(folder.briefPath, documents.brief);
  writeJsonAtomic(folder.treatmentPath, documents.treatment);
  writeJsonAtomic(folder.shotSpecPath, documents.shotSpec);
  writeJsonAtomic(folder.lookPath, documents.look);
  writeJsonAtomic(folder.jobPath, job);
}
