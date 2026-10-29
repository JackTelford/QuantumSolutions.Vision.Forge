/**
 * `render --job <folder or job.json> [--shot <id>] [--renderer
 * hardware|software|any] [--frames <a-b>] [--force] [--allow-unapproved]`:
 * renders every frame of the approved browser-lane shots into their cache
 * folders, one harness server and one browser for the whole run.
 *
 * A shot renders when it is still-approved (or already rendered, whose
 * complete manifest is reused unless --force) under its current key; the
 * key is recomputed here with the lane code hash, so a lane code or browser
 * change since the still makes the shot unapproved again (ADR 0006
 * decision 8). The renderer must be the one the still gate pinned: a fixed
 * --renderer that disagrees is refused before anything launches, and `any`
 * adopts the pinned one. A blender shot is skipped with a warning unless
 * named with --shot, when it is an error (M5).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VisionForgeError } from '../../errors/vision-forge-error.ts';
import { ensureDirectory, removeDirectoryWithRetry } from '../../fs/paths.ts';
import type { BrowserRenderer } from '../../harness/types.ts';
import { shotKey } from '../../plan/shot-key.ts';
import { framePattern, framesDir, manifestPath, shotCacheDir } from '../../render/cache.ts';
import { assertRendererMatches, effectivePolicy, framesOf, keyFingerprint, parseFrameRange, parseRendererPolicy, readRenderTools } from '../../render/command-support.ts';
import { findJobShot, findShot, loadJob, saveJob, updateShot } from '../../render/job-state.ts';
import type { LoadedJob } from '../../render/job-state.ts';
import { isComplete, readManifest } from '../../render/manifest.ts';
import type { ManifestFingerprint } from '../../render/manifest.ts';
import { renderShot } from '../../render/render-shot.ts';
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
}

/** Shape of the render payload. */
export interface RenderData {
  readonly jobId: string;
  readonly shots: readonly RenderShotData[];
  /** Blender shots left out of this run. */
  readonly skipped: readonly string[];
  readonly totalFrames: number;
  readonly elapsedMs: number;
}

/** A shot of the run with its key, its frames and whether its finished render can be reused as it is. */
interface PlannedShot {
  readonly shot: Shot;
  readonly key: string;
  readonly frames: readonly number[];
  readonly cacheDir: string;
  readonly reuseWhole: boolean;
}

/** The page directory of a job's renders: one page for every shot, since every shot of a spec has the same size. */
export function jobPageDir(jobDir: string): string {
  return join(jobDir, 'page');
}

/** The shots to render: the named one, or every browser-lane shot with the blender ones reported as skipped. */
export function selectShots(loaded: LoadedJob, shotId: string | undefined): { readonly selected: readonly Shot[]; readonly skipped: readonly string[] } {
  if (shotId !== undefined) {
    const shot = findShot(loaded.shotSpec, shotId);
    browserLaneOf(shot);
    return { selected: [shot], skipped: [] };
  }
  const selected = loaded.shotSpec.shots.filter((shot) => shot.lane !== 'blender');
  return { selected, skipped: loaded.shotSpec.shots.filter((shot) => shot.lane === 'blender').map((shot) => shot.id) };
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

/** Plans every selected shot: its key and the approval decision; throws before any launch when a shot is not approved. */
async function planShots(context: CommandContext, loaded: LoadedJob, selected: readonly Shot[], framesByShot: ReadonlyMap<string, readonly number[]>, args: ParsedArguments, seams: RenderSeams): Promise<readonly PlannedShot[]> {
  const force = args.flag('force');
  const allowUnapproved = args.flag('allow-unapproved');
  const fingerprints = new Map<Lane, Awaited<ReturnType<typeof keyFingerprint>>>();
  const planned: PlannedShot[] = [];
  for (const shot of selected) {
    const frames = framesByShot.get(shot.id) ?? [];
    const fingerprint = fingerprints.get(shot.lane) ?? await keyFingerprint(context.dataDir, shot.lane, seams);
    fingerprints.set(shot.lane, fingerprint);
    const key = await shotKey(shot, loaded.look, fingerprint);
    const reuseWhole = !force && hasCompleteRender(loaded.job, shot, key);
    const reason = unapprovedReason(loaded.job, shot, key);
    if (reason !== undefined && !reuseWhole) {
      if (!allowUnapproved) throw new ShotNotApprovedError(shot.id, reason, loaded.folder.dir);
      context.log.warn(`shot "${shot.id}" renders unapproved: ${reason}`);
    }
    planned.push({ shot, key, frames, cacheDir: shotCacheDir(context.dataDir, key), reuseWhole });
  }
  return planned;
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
    for (const id of skipped) context.log.warn(`shot "${id}" uses the blender lane and is skipped (M5)`);
    if (selected.length === 0) {
      throw new VisionForgeError({ code: 'lane-unavailable', message: 'Every shot of the job uses the blender lane, which cannot render yet.', hint: 'The blender lane arrives with milestone M5; plan at least one shot on the html or three lane.' });
    }
    // Every argument and approval check runs before tools.json is read and before anything launches.
    const range = parseFrameRange(args.string('frames'));
    const framesByShot = new Map(selected.map((shot) => [shot.id, framesOf(shot, range)] as const));
    const askedPolicy = parseRendererPolicy(args.string('renderer'));
    const seams = await loadRealSeams();
    const planned = await planShots(context, loaded, selected, framesByShot, args, seams);
    const toRender = planned.filter((entry) => !entry.reuseWhole);
    // Only the shots this run renders pin the browser; a finished shot reused whole has no say in it.
    const shotsToRender = toRender.map((entry) => entry.shot);
    const policy = effectivePolicy(askedPolicy, shotsToRender);
    const tools = readRenderTools(context.dataDir);
    const spec: RenderSpec = { fps: loaded.shotSpec.fps, width: loaded.shotSpec.width, height: loaded.shotSpec.height };
    const pageDirectory = ensureDirectory(jobPageDir(loaded.folder.dir));

    let job = loaded.job;
    const shots: RenderShotData[] = [];
    let renderer: BrowserRenderer | undefined;
    let harness: HarnessHandle | undefined;
    try {
      if (toRender.length > 0) {
        harness = await seams.startHarness({ pageDir: pageDirectory, dataDir: context.dataDir, log: context.log, signal: context.signal });
        renderer = await seams.openRenderer({ browser: tools.browser, policy, width: spec.width, height: spec.height, dataDir: context.dataDir, log: context.log, signal: context.signal });
        assertRendererMatches(renderer.profile, shotsToRender);
        context.log.info(`renderer: ${renderer.profile.renderer} (${renderer.profile.engine}, ${renderer.profile.backend}) with ${tools.browser.channel} ${tools.browser.version}`);
      }
      const fingerprints = new Map<Lane, ManifestFingerprint>();
      for (const entry of planned) {
        const { shot, key, frames, cacheDir } = entry;
        if (entry.reuseWhole) {
          const path = findJobShot(job, shot.id).manifestPath ?? manifestPath(cacheDir);
          // The counts are the requested frames, as for a rendered shot, so --frames a-b adds up the same either way.
          context.log.info(`${shot.id}  ${shot.lane}  ${frames.length} frames already rendered; reused`);
          shots.push({ id: shot.id, key, lane: shot.lane, frames: frames.length, framesDir: framesDir(cacheDir), framePattern: framePattern(framesDir(cacheDir)), manifestPath: path, elapsedMs: 0, msPerFrame: 0, reused: frames.length });
          continue;
        }
        if (renderer === undefined || harness === undefined) throw new Error('The renderer was not opened.');
        if (args.flag('force') && existsSync(cacheDir)) await removeDirectoryWithRetry(cacheDir);
        const lane = browserLaneOf(shot);
        const fingerprint = fingerprints.get(lane) ?? await seams.manifestFingerprint({ renderer, lane, ffmpegVersion: tools.ffmpeg.version, runner: context.runner, signal: context.signal });
        fingerprints.set(lane, fingerprint);
        const result = await renderShot({
          renderer, page: seams, harnessUrl: harness.url, pageDir: pageDirectory, shot, look: loaded.look, spec, frames, cacheDir, key, fingerprint,
          runner: context.runner, ffmpegPath: tools.ffmpeg.path, log: context.log, signal: context.signal, now: context.now,
          environment: resolveEnvironment(shot, context.dataDir),
        });
        const complete = isComplete(readManifest(result.manifestPath), shot.durationFrames);
        job = updateShot(job, shot.id, { key, manifestPath: result.manifestPath, ...(complete ? { status: 'rendered' as const } : {}) });
        job = { ...job, status: 'rendering' };
        saveJob(loaded.folder, job);
        context.log.info(`${shot.id}  ${shot.lane}  ${frames.length} frames  ${result.elapsedMs} ms  ${result.msPerFrame.toFixed(1)} ms/frame  ${result.reused} reused`);
        shots.push({ id: shot.id, key, lane: shot.lane, frames: frames.length, framesDir: result.framesDir, framePattern: result.framePattern, manifestPath: result.manifestPath, elapsedMs: result.elapsedMs, msPerFrame: result.msPerFrame, reused: result.reused });
      }
    } finally {
      if (renderer !== undefined) await renderer.close();
      if (harness !== undefined) await harness.stop();
    }
    const data: RenderData = { jobId: job.id, shots, skipped, totalFrames: shots.reduce((sum, shot) => sum + shot.frames, 0), elapsedMs: context.now().getTime() - started };
    return { data, artifacts: [], evidence: shots.map((shot) => shot.manifestPath) };
  },
};
