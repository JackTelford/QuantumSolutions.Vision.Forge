/**
 * A job folder in the state render leaves it, built without a browser or
 * Blender: the fixture quartet at a small size written for the plan command,
 * then every shot's frames as solid-colour PNGs in its cache with a complete
 * manifest, one graded still per shot (the raw frame through finishStill, as
 * the still command grades it) and job.json with every shot rendered. The
 * assemble --job and qa --job tests run over it with the real ffmpeg. Not a
 * test file: the test runner never loads it on its own.
 */
import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { framePath, framesDir, manifestPath, shotCacheDir } from '../../src/render/cache.ts';
import { finishStill } from '../../src/render/finish-still.ts';
import { addFrames, complete, newManifest, writeManifest } from '../../src/render/manifest.ts';
import { defaultStillFrame } from '../../src/render/still-frame.ts';
import type { Job, JobShot } from '../../src/shared/contracts/job.ts';
import type { LookBible } from '../../src/shared/contracts/look-bible.ts';
import type { Shot, ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { writeSolidPng } from '../fakes/png.ts';
import type { Rgb } from '../fakes/png.ts';
import { planBrief, planLook, planShotSpec, planTreatment } from '../plan/fixtures.ts';
import { manifestInputs } from '../render/fixtures.ts';
import { hex64, mutated } from '../schema/documents/examples.ts';

/** The frame size of the rendered fixture job: small enough for 315 PNGs and three encodes to take seconds. */
export const renderedJobSize: { readonly width: number; readonly height: number } = { width: 320, height: 180 };

/**
 * The look of the rendered fixture job: the obsidian look without grain.
 * Grain is not a constraint, only a margin: measured 2026-10-29 with ffmpeg
 * 9.0.2 over these flat frames, planLook's grain 0.15 gives hero-still-match
 * SSIM 0.9904 (s02) and 0.9894 (s03), 0.01 over the 0.98 threshold, where
 * grain 0 gives 0.9945 and 0.9929; the test should not ride on that margin
 * across ffmpeg versions. The grain path itself is covered by the assembler
 * tests.
 */
export const renderedJobLook: LookBible = mutated(planLook, (copy) => { copy.grade.grainAmount = 0; });

/** The four document paths the plan command takes. */
export interface FixtureDocuments {
  readonly brief: string;
  readonly treatment: string;
  readonly shotSpec: string;
  readonly look: string;
}

/** Writes the fixture quartet at the rendered job's size into the folder, for the plan command. */
export function writeFixtureDocuments(dir: string): FixtureDocuments {
  const { width, height } = renderedJobSize;
  const paths: FixtureDocuments = { brief: join(dir, 'brief.json'), treatment: join(dir, 'treatment.json'), shotSpec: join(dir, 'shot-spec.json'), look: join(dir, 'look.json') };
  writeJsonAtomic(paths.brief, mutated(planBrief, (copy) => { copy.width = width; copy.height = height; }));
  writeJsonAtomic(paths.treatment, planTreatment);
  writeJsonAtomic(paths.shotSpec, mutated(planShotSpec, (copy) => { copy.width = width; copy.height = height; }));
  writeJsonAtomic(paths.look, renderedJobLook);
  return paths;
}

/**
 * The colour of a frame of a shot: dark (so the look's near-white text
 * clears 4.5:1 over it and no frame reads as black), a little different on
 * every frame (so none is frozen and no adjacent pair pops), and a little
 * different per shot (within the exposure-drift threshold).
 */
export function fixtureFrameColor(shotIndex: number, frame: number): Rgb {
  return [40 + shotIndex * 6 + (frame % 24), 44 + ((frame * 3) % 30), 52 + ((frame * 5) % 36)];
}

/** What renderFixtureJob built. */
export interface RenderedJob {
  readonly jobDir: string;
  readonly job: Job;
  readonly shotSpec: ShotSpec;
  readonly look: LookBible;
}

/** The latest still of a shot, as the still command names it: `<job>/stills/<shot>-r1.png`. */
export function fixtureStillPath(jobDir: string, shotId: string): string {
  return join(jobDir, 'stills', `${shotId}-r1.png`);
}

/** Writes the shot's frames into its cache with a complete manifest and returns the manifest's path. */
async function renderFixtureShot(dataDir: string, shot: Shot, shotIndex: number, key: string, fps: number): Promise<string> {
  const cacheDir = shotCacheDir(dataDir, key);
  const frames = framesDir(cacheDir);
  for (let frame = 0; frame < shot.durationFrames; frame += 1) writeSolidPng(framePath(frames, frame), renderedJobSize.width, renderedJobSize.height, fixtureFrameColor(shotIndex, frame));
  // The hashes are not read back by assemble or qa; a manifest is complete when every frame has an entry.
  const fresh = await newManifest(manifestInputs({ shotId: shot.id, key, lane: shot.lane, fps, width: renderedJobSize.width, height: renderedJobSize.height, frameCount: shot.durationFrames }));
  const entries = Array.from({ length: shot.durationFrames }, (_, index) => ({ index, sha256: hex64('e') }));
  const path = manifestPath(cacheDir);
  writeManifest(path, complete(addFrames(fresh, entries), '2026-10-29T10:01:00.000Z'));
  return path;
}

/** Fills a planned job folder as render would have: frames, manifests, one graded still per shot, and job.json with every shot rendered. */
export async function renderFixtureJob(jobDir: string, dataDir: string, ffmpegPath: string): Promise<RenderedJob> {
  const runner = new ChildProcessRunner();
  const never = new AbortController().signal;
  const job = readJsonFile(join(jobDir, 'job.json')) as Job;
  const shotSpec = readJsonFile(join(jobDir, 'shot-spec.json')) as ShotSpec;
  const look = readJsonFile(join(jobDir, 'look-bible.json')) as LookBible;
  const shots: JobShot[] = [];
  for (const [index, shot] of shotSpec.shots.entries()) {
    const entry = job.shots.find((candidate) => candidate.id === shot.id);
    if (entry === undefined) throw new Error(`job.json has no entry for ${shot.id}`);
    const manifest = await renderFixtureShot(dataDir, shot, index, entry.key, shotSpec.fps);
    const still = fixtureStillPath(jobDir, shot.id);
    const raw = still.replace(/\.png$/, '.raw.png');
    writeSolidPng(raw, renderedJobSize.width, renderedJobSize.height, fixtureFrameColor(index, defaultStillFrame(shot, shotSpec.fps)));
    await finishStill(runner, ffmpegPath, raw, still, look, never);
    shots.push({ ...entry, status: 'rendered' as const, manifestPath: manifest, stillPath: still, rounds: 1 });
  }
  const rendered: Job = { ...job, status: 'rendering', shots };
  writeJsonAtomic(join(jobDir, 'job.json'), rendered);
  return { jobDir, job: rendered, shotSpec, look };
}
