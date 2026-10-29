/**
 * `render --job <folder or job.json> [--shot <id>] [--renderer
 * hardware|software|any] [--frames <a-b>] [--force] [--allow-unapproved]`:
 * renders every frame of the approved shots into their cache folders, one
 * harness server and one browser for the browser-lane shots of the run,
 * and one Blender process per batch for the blender-lane shots, shot after
 * shot: Blender never runs while the browser is capturing, though the
 * browser, once opened, stays open between the shots of a run.
 *
 * A shot renders when it is still-approved (or already rendered, whose
 * complete manifest is reused unless --force) under its current key; the
 * key is recomputed here with the lane code hash, so a lane code or browser
 * change since the still makes the shot unapproved again (ADR 0006
 * decision 8). The renderer must be the one the still gate pinned: a fixed
 * --renderer that disagrees is refused before anything launches, and `any`
 * adopts the pinned one. A blender shot renders with the engine and device
 * its still pinned and no other (ADR 0004 decision 6); a shot pinned to the
 * CPU, or not pinned at all, is refused before anything launches.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDirectory, removeDirectoryWithRetry } from '../../fs/paths.ts';
import type { BrowserRenderer, RendererPolicy } from '../../harness/types.ts';
import { combineEstimates } from '../../lanes/blender/estimator.ts';
import type { RenderEstimate } from '../../lanes/blender/estimator.ts';
import { renderAttempt } from '../../lanes/blender/ladder.ts';
import type { LadderAttempt } from '../../lanes/blender/ladder.ts';
import { laneFingerprint, shotKey } from '../../plan/shot-key.ts';
import type { RenderFingerprint } from '../../plan/shot-key.ts';
import { blenderHdriPath } from '../../render/environment.ts';
import { blenderFingerprint, readBlenderTools, realBlenderSeams, renderBlenderShot } from '../../render/blender-shot.ts';
import type { BlenderRenderTools } from '../../render/blender-shot.ts';
import { framePattern, framesDir, manifestPath, shotCacheDir } from '../../render/cache.ts';
import { assertRendererMatches, effectivePolicy, framesOf, keyFingerprint, parseFrameRange, parseRendererPolicy, readRenderTools } from '../../render/command-support.ts';
import type { RenderTools } from '../../render/command-support.ts';
import { findJobShot, findShot, loadJob, saveJob, updateShot } from '../../render/job-state.ts';
import type { LoadedJob } from '../../render/job-state.ts';
import { isComplete, readManifest } from '../../render/manifest.ts';
import type { ManifestFingerprint } from '../../render/manifest.ts';
import { renderShot } from '../../render/render-shot.ts';
import type { RenderShotResult } from '../../render/render-shot.ts';
import { loadRealSeams } from '../../render/seams.ts';
import type { HarnessHandle, RenderSeams } from '../../render/seams.ts';
import { resolveEnvironment } from '../../render/environment.ts';
import { browserLaneOf } from '../../render/shot-page-spec.ts';
import { ShotNotApprovedError } from '../../render/shot-not-approved-error.ts';
import type { RenderSpec } from '../../shared/camera/types.ts';
import type { Job } from '../../shared/contracts/job.ts';
import type { Lane, Shot } from '../../shared/contracts/shot-spec.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { Command, CommandContext } from '../command.ts';
import type { CommandOutput } from '../result.ts';

/** One rendered shot of the payload. */
export interface RenderShotData {
  readonly id: string;
  readonly key: string;
  readonly lane: Lane;
  /** How many frames were asked for. */
  readonly frames: number;
  readonly framesDir: string;
  readonly framePattern: string;
  readonly manifestPath: string;
  readonly elapsedMs: number;
  readonly msPerFrame: number;
  /** How many of the frames were already in the cache. */
  readonly reused: number;
  /** The time estimate a blender shot measured on its first batch; null for a browser shot or a shot rendered in one batch. */
  readonly estimate: RenderEstimate | null;
}

/** Shape of the render payload. */
export interface RenderData {
  readonly jobId: string;
  readonly shots: readonly RenderShotData[];
  /** Shots left out of this run; empty since the blender lane renders (M5), kept for readers of older results. */
  readonly skipped: readonly string[];
  readonly totalFrames: number;
  readonly elapsedMs: number;
  /** The blender shots' estimates combined (the frame-weighted rate and the summed total); null when none was measured. */
  readonly estimate: RenderEstimate | null;
}

/** A shot of the run with its key, its frames and whether its finished render can be reused as it is. */
interface PlannedShot {
  readonly shot: Shot;
  readonly key: string;
  readonly frames: readonly number[];
  readonly cacheDir: string;
  readonly reuseWhole: boolean;
  /** The pinned Blender attempt of a blender shot to render; undefined for a browser shot or a reused one. */
  readonly blenderAttempt: LadderAttempt | undefined;
}

/** The page directory of a job's renders: one page for every shot, since every shot of a spec has the same size. */
export function jobPageDir(jobDir: string): string {
  return join(jobDir, 'page');
}

/** The shots to render: the named one, or every shot of the spec. */
export function selectShots(loaded: LoadedJob, shotId: string | undefined): { readonly selected: readonly Shot[]; readonly skipped: readonly string[] } {
  if (shotId !== undefined) return { selected: [findShot(loaded.shotSpec, shotId)], skipped: [] };
  return { selected: [...loaded.shotSpec.shots], skipped: [] };
}

/** True when the job shot is rendered under this key with a complete manifest on disk. */
function hasCompleteRender(job: Job, shot: Shot, key: string): boolean {
  const jobShot = findJobShot(job, shot.id);
  if (jobShot.status !== 'rendered' || jobShot.key !== key || jobShot.manifestPath === null || !existsSync(jobShot.manifestPath)) return false;
  try {
    const manifest = readManifest(jobShot.manifestPath);
    return manifest.key === key && isComplete(manifest, shot.durationFrames);
  } catch {
    return false;
  }
}

/** Why a shot is not approved under its current key, or undefined when it is. */
function unapprovedReason(job: Job, shot: Shot, key: string): string | undefined {
  const jobShot = findJobShot(job, shot.id);
  if (jobShot.status !== 'still-approved' && jobShot.status !== 'rendered') return `its status is ${jobShot.status}, not still-approved`;
  if (jobShot.key !== key) return 'its key changed since the still was approved (the lane code, the browser or the shot changed), so the still no longer stands for it';
  return undefined;
}

/** Plans every selected shot: its key, the approval decision and, for a blender shot, its pinned attempt; throws before any launch when a shot is not approved or a Blender pin is unusable or disagrees with --renderer. */
async function planShots(context: CommandContext, loaded: LoadedJob, selected: readonly Shot[], framesByShot: ReadonlyMap<string, readonly number[]>, args: ParsedArguments, seams: RenderSeams, width: number, policy: RendererPolicy): Promise<readonly PlannedShot[]> {
  const force = args.flag('force');
  const allowUnapproved = args.flag('allow-unapproved');
  const fingerprints = new Map<Lane, RenderFingerprint>();
  const planned: PlannedShot[] = [];
  for (const shot of selected) {
    const frames = framesByShot.get(shot.id) ?? [];
    // A blender shot's key has no browser in it (src/plan/shot-key.ts); the browser lanes take theirs through the seams so tests can fake the hash.
    const fingerprint = fingerprints.get(shot.lane) ?? (shot.lane === 'blender' ? await laneFingerprint(context.dataDir, 'blender') : await keyFingerprint(context.dataDir, shot.lane, seams));
    fingerprints.set(shot.lane, fingerprint);
    const key = await shotKey(shot, loaded.look, fingerprint);
    const reuseWhole = !force && hasCompleteRender(loaded.job, shot, key);
    const reason = unapprovedReason(loaded.job, shot, key);
    if (reason !== undefined && !reuseWhole) {
      if (!allowUnapproved) throw new ShotNotApprovedError(shot.id, reason, loaded.folder.dir);
      context.log.warn(`shot "${shot.id}" renders unapproved: ${reason}`);
    }
    const blenderAttempt = shot.lane === 'blender' && !reuseWhole ? renderAttempt(shot.id, shot.renderProfile, width, policy) : undefined;
    planned.push({ shot, key, frames, cacheDir: shotCacheDir(context.dataDir, key), reuseWhole, blenderAttempt });
  }
  return planned;
}

/** The payload entry of a rendered or reused shot. */
function shotData(entry: PlannedShot, result: RenderShotResult, estimate: RenderEstimate | null): RenderShotData {
  return { id: entry.shot.id, key: entry.key, lane: entry.shot.lane, frames: entry.frames.length, framesDir: result.framesDir, framePattern: result.framePattern, manifestPath: result.manifestPath, elapsedMs: result.elapsedMs, msPerFrame: result.msPerFrame, reused: result.reused, estimate };
}

/** The browser session of a run: opened once before the first browser shot, closed after the last. */
interface BrowserRun {
  /** Read only when a browser shot is to render; a run of blender shots alone needs no browser. */
  readonly tools: RenderTools | undefined;
  readonly seams: RenderSeams;
  readonly pageDirectory: string;
  renderer: BrowserRenderer | undefined;
  harness: HarnessHandle | undefined;
  readonly fingerprints: Map<Lane, ManifestFingerprint>;
}

/** Renders one browser shot through the run's browser. */
async function renderBrowserEntry(context: CommandContext, loaded: LoadedJob, spec: RenderSpec, run: BrowserRun, entry: PlannedShot): Promise<RenderShotResult> {
  if (run.renderer === undefined || run.harness === undefined || run.tools === undefined) throw new Error('The renderer was not opened.');
  const { shot, key, frames, cacheDir } = entry;
  const lane = browserLaneOf(shot);
  const fingerprint = run.fingerprints.get(lane) ?? await run.seams.manifestFingerprint({ renderer: run.renderer, lane, ffmpegVersion: run.tools.ffmpeg.version, runner: context.runner, signal: context.signal });
  run.fingerprints.set(lane, fingerprint);
  return renderShot({
    renderer: run.renderer, page: run.seams, harnessUrl: run.harness.url, pageDir: run.pageDirectory, shot, look: loaded.look, spec, frames, cacheDir, key, fingerprint,
    runner: context.runner, ffmpegPath: run.tools.ffmpeg.path, log: context.log, signal: context.signal, now: context.now,
    environment: resolveEnvironment(shot, context.dataDir),
  });
}

/** Renders one blender shot with its pinned attempt, batch by batch. */
function renderBlenderEntry(context: CommandContext, loaded: LoadedJob, spec: RenderSpec, tools: BlenderRenderTools, entry: PlannedShot, attempt: LadderAttempt): ReturnType<typeof renderBlenderShot> {
  const { shot, key, frames, cacheDir } = entry;
  context.log.info(`${shot.id}  blender  ${attempt.name} (${attempt.attempt.samples} samples) with Blender ${tools.blender.version}`);
  return renderBlenderShot({
    seams: realBlenderSeams, shot, look: loaded.look, spec, frames, cacheDir, key, fingerprint: blenderFingerprint(tools.blender.version, tools.ffmpeg.version), attempt,
    blenderPath: tools.blender.path, dataDir: context.dataDir, hdriPath: blenderHdriPath(shot, context.dataDir),
    runner: context.runner, ffmpegPath: tools.ffmpeg.path, log: context.log, signal: context.signal, now: context.now,
  });
}

/** The render command. */
export const command: Command = {
  name: 'render',
  summary: 'Render the approved shots of a job frame by frame into the cache, with a manifest of pixel hashes per shot.',
  options: { strings: ['job', 'shot', 'renderer', 'frames'], flags: ['force', 'allow-unapproved'] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const started = context.now().getTime();
    const loaded = loadJob(resolve(context.cwd, args.requireString('job', 'the job folder (or its job.json) the plan command wrote')));
    const { selected, skipped } = selectShots(loaded, args.string('shot'));
    // Every argument and approval check runs before tools.json is read and before anything launches.
    const range = parseFrameRange(args.string('frames'));
    const framesByShot = new Map(selected.map((shot) => [shot.id, framesOf(shot, range)] as const));
    const askedPolicy = parseRendererPolicy(args.string('renderer'));
    const seams = await loadRealSeams();
    const spec: RenderSpec = { fps: loaded.shotSpec.fps, width: loaded.shotSpec.width, height: loaded.shotSpec.height };
    const planned = await planShots(context, loaded, selected, framesByShot, args, seams, spec.width, askedPolicy);
    const toRender = planned.filter((entry) => !entry.reuseWhole);
    // Only the browser shots this run renders pin the browser; a finished shot reused whole and a blender shot have no say in it.
    const browserShots = toRender.filter((entry) => entry.shot.lane !== 'blender').map((entry) => entry.shot);
    const policy = effectivePolicy(askedPolicy, browserShots);
    const browserTools = browserShots.length > 0 ? readRenderTools(context.dataDir) : undefined;
    const blenderTools = toRender.some((entry) => entry.shot.lane === 'blender') ? readBlenderTools(context.dataDir) : undefined;
    const run: BrowserRun = { tools: browserTools, seams, pageDirectory: ensureDirectory(jobPageDir(loaded.folder.dir)), renderer: undefined, harness: undefined, fingerprints: new Map() };

    let job = loaded.job;
    const shots: RenderShotData[] = [];
    const estimates: { readonly estimate: RenderEstimate; readonly frames: number }[] = [];
    try {
      if (browserTools !== undefined) {
        run.harness = await seams.startHarness({ pageDir: run.pageDirectory, dataDir: context.dataDir, log: context.log, signal: context.signal });
        run.renderer = await seams.openRenderer({ browser: browserTools.browser, policy, width: spec.width, height: spec.height, dataDir: context.dataDir, log: context.log, signal: context.signal });
        assertRendererMatches(run.renderer.profile, browserShots);
        context.log.info(`renderer: ${run.renderer.profile.renderer} (${run.renderer.profile.engine}, ${run.renderer.profile.backend}) with ${browserTools.browser.channel} ${browserTools.browser.version}`);
      }
      for (const entry of planned) {
        const { shot, key, frames, cacheDir } = entry;
        if (entry.reuseWhole) {
          const path = findJobShot(job, shot.id).manifestPath ?? manifestPath(cacheDir);
          // The counts are the requested frames, as for a rendered shot, so --frames a-b adds up the same either way.
          context.log.info(`${shot.id}  ${shot.lane}  ${frames.length} frames already rendered; reused`);
          shots.push({ id: shot.id, key, lane: shot.lane, frames: frames.length, framesDir: framesDir(cacheDir), framePattern: framePattern(framesDir(cacheDir)), manifestPath: path, elapsedMs: 0, msPerFrame: 0, reused: frames.length, estimate: null });
          continue;
        }
        if (args.flag('force') && existsSync(cacheDir)) await removeDirectoryWithRetry(cacheDir);
        let result: RenderShotResult;
        let estimate: RenderEstimate | null = null;
        if (entry.blenderAttempt !== undefined && blenderTools !== undefined) {
          const rendered = await renderBlenderEntry(context, loaded, spec, blenderTools, entry, entry.blenderAttempt);
          result = rendered;
          estimate = rendered.estimate;
          if (estimate !== null) estimates.push({ estimate, frames: frames.length - result.reused });
        } else {
          result = await renderBrowserEntry(context, loaded, spec, run, entry);
        }
        const complete = isComplete(readManifest(result.manifestPath), shot.durationFrames);
        job = updateShot(job, shot.id, { key, manifestPath: result.manifestPath, ...(complete ? { status: 'rendered' as const } : {}) });
        job = { ...job, status: 'rendering' };
        saveJob(loaded.folder, job);
        context.log.info(`${shot.id}  ${shot.lane}  ${frames.length} frames  ${result.elapsedMs} ms  ${result.msPerFrame.toFixed(1)} ms/frame  ${result.reused} reused`);
        shots.push(shotData(entry, result, estimate));
      }
    } finally {
      if (run.renderer !== undefined) await run.renderer.close();
      if (run.harness !== undefined) await run.harness.stop();
    }
    const data: RenderData = { jobId: job.id, shots, skipped, totalFrames: shots.reduce((sum, shot) => sum + shot.frames, 0), elapsedMs: context.now().getTime() - started, estimate: combineEstimates(estimates) };
    return { data, artifacts: [], evidence: shots.map((shot) => shot.manifestPath) };
  },
};
