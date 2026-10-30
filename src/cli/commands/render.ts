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
 *
 * A three or blender shot with text renders its text plate right after
 * its picture (ADR 0008 decision 4, src/render/text-plate.ts): the html
 * lane's words over transparency, under the plate's own key, through the
 * run's browser, resumable like any shot. The approved still is the
 * composite, so a plate re-keyed by an html lane or browser change
 * unapproves the shot like a picture change. The shot counts as rendered
 * when both plates are complete, and `data.shots[]` names the plate's
 * frame pattern for the assembly.
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
import { findJobShot, findShot, loadJob, saveJob, updateShot, withoutTextPlate } from '../../render/job-state.ts';
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
import { hasTextPlate, renderTextPlate, textPlateKey } from '../../render/text-plate.ts';
import type { TextPlateSession } from '../../render/text-plate.ts';
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
  /** The ffmpeg pattern of the shot's text plate frames (ADR 0008 decision 4); null for an html shot or a shot without text. */
  readonly textFramePattern: string | null;
  /** The text plate's render manifest; null when the shot has no text plate. */
  readonly textManifestPath: string | null;
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
  /** The key of the shot's text plate; undefined for an html shot or a shot without text. */
  readonly textKey: string | undefined;
  /** True when the text plate is rendered under this key with a complete manifest, so the browser is not needed for it. */
  readonly textReuseWhole: boolean;
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

/** True when a manifest at the path exists, records the key and is complete for the shot's length. */
function manifestComplete(path: string | null | undefined, key: string, shot: Shot): boolean {
  if (path === undefined || path === null || !existsSync(path)) return false;
  try {
    const manifest = readManifest(path);
    return manifest.key === key && isComplete(manifest, shot.durationFrames);
  } catch {
    return false;
  }
}

/** True when the job shot is rendered under this key with a complete manifest on disk. */
function hasCompleteRender(job: Job, shot: Shot, key: string): boolean {
  const jobShot = findJobShot(job, shot.id);
  return jobShot.status === 'rendered' && jobShot.key === key && manifestComplete(jobShot.manifestPath, key, shot);
}

/** Why a shot is not approved under its current keys, or undefined when it is; `textKey` is the shot's text plate key, undefined for a shot without one. */
function unapprovedReason(job: Job, shot: Shot, key: string, textKey: string | undefined): string | undefined {
  const jobShot = findJobShot(job, shot.id);
  if (jobShot.status !== 'still-approved' && jobShot.status !== 'rendered') return `its status is ${jobShot.status}, not still-approved`;
  if (jobShot.key !== key) return 'its key changed since the still was approved (the lane code, the browser or the shot changed), so the still no longer stands for it';
  // The approved still is the composite of both plates (ADR 0008 decision 4), so a plate re-keyed by the html lane or the browser unapproves the shot as a picture change would (ADR 0006 decision 8).
  if (textKey !== undefined && jobShot.textKey !== undefined && jobShot.textKey !== textKey) return "its text plate's key changed since the still was approved (the html lane or the browser changed), so the still no longer stands for it";
  return undefined;
}

/** Plans every selected shot: its key, the approval decision, its text plate and, for a blender shot, its pinned attempt; throws before any launch when a shot is not approved or a Blender pin is unusable or disagrees with --renderer. */
async function planShots(context: CommandContext, loaded: LoadedJob, selected: readonly Shot[], framesByShot: ReadonlyMap<string, readonly number[]>, args: ParsedArguments, seams: RenderSeams, width: number, policy: RendererPolicy): Promise<readonly PlannedShot[]> {
  const force = args.flag('force');
  const allowUnapproved = args.flag('allow-unapproved');
  const fingerprints = new Map<Lane, RenderFingerprint>();
  const fingerprintOf = async (lane: Lane): Promise<RenderFingerprint> => {
    // A blender shot's key has no browser in it (src/plan/shot-key.ts); the browser lanes take theirs through the seams so tests can fake the hash.
    const fingerprint = fingerprints.get(lane) ?? (lane === 'blender' ? await laneFingerprint(context.dataDir, 'blender') : await keyFingerprint(context.dataDir, lane, seams));
    fingerprints.set(lane, fingerprint);
    return fingerprint;
  };
  const planned: PlannedShot[] = [];
  for (const shot of selected) {
    const frames = framesByShot.get(shot.id) ?? [];
    const key = await shotKey(shot, loaded.look, await fingerprintOf(shot.lane));
    // The text plate renders in the html lane whatever the shot's lane, so its key carries the html lane's fingerprint.
    const textKey = hasTextPlate(shot) ? await textPlateKey(key, await fingerprintOf('html')) : undefined;
    const jobShot = findJobShot(loaded.job, shot.id);
    const reuseWhole = !force && hasCompleteRender(loaded.job, shot, key);
    const textReuseWhole = textKey !== undefined && !force && jobShot.textKey === textKey && manifestComplete(jobShot.textManifestPath, textKey, shot);
    const reason = unapprovedReason(loaded.job, shot, key, textKey);
    // A shot whose picture and plate are both reused whole renders nothing, so its approval is not asked again.
    const nothingRenders = reuseWhole && (textKey === undefined || textReuseWhole);
    if (reason !== undefined && !nothingRenders) {
      if (!allowUnapproved) throw new ShotNotApprovedError(shot.id, reason, loaded.folder.dir);
      context.log.warn(`shot "${shot.id}" renders unapproved: ${reason}`);
    }
    const blenderAttempt = shot.lane === 'blender' && !reuseWhole ? renderAttempt(shot.id, shot.renderProfile, width, policy) : undefined;
    planned.push({ shot, key, frames, cacheDir: shotCacheDir(context.dataDir, key), reuseWhole, blenderAttempt, textKey, textReuseWhole });
  }
  return planned;
}

/** What a shot's text plate came to: where its frames and manifest are, and whether every frame is there. */
interface TextPlateOutcome {
  readonly key: string;
  readonly framePattern: string;
  readonly manifestPath: string;
  readonly complete: boolean;
}

/** The payload entry of a rendered or reused shot. */
function shotData(entry: PlannedShot, result: RenderShotResult, estimate: RenderEstimate | null, text: TextPlateOutcome | undefined): RenderShotData {
  return {
    id: entry.shot.id, key: entry.key, lane: entry.shot.lane, frames: entry.frames.length, framesDir: result.framesDir, framePattern: result.framePattern, manifestPath: result.manifestPath,
    textFramePattern: text === undefined ? null : text.framePattern, textManifestPath: text === undefined ? null : text.manifestPath,
    elapsedMs: result.elapsedMs, msPerFrame: result.msPerFrame, reused: result.reused, estimate,
  };
}

/**
 * The job with the shot's render recorded: its key and manifest, its text
 * plate's key and manifest (or none: a shot that lost its plate drops the
 * fields an earlier run recorded), and its status. The shot is rendered
 * when both plates are complete; a rendered shot whose re-keyed plate is
 * only partly rendered (--frames a-b) steps back to still-approved, which
 * it already stood for, so job.json never says rendered over a rendering
 * manifest; any other status stays.
 */
function recordRender(job: Job, entry: PlannedShot, result: RenderShotResult, text: TextPlateOutcome | undefined): Job {
  const { shot, key } = entry;
  const complete = isComplete(readManifest(result.manifestPath), shot.durationFrames) && (text === undefined || text.complete);
  const was = findJobShot(job, shot.id).status;
  const status = complete ? 'rendered' : was === 'rendered' ? 'still-approved' : was;
  const base = text === undefined ? withoutTextPlate(job, shot.id) : job;
  return updateShot(base, shot.id, { key, manifestPath: result.manifestPath, status, ...(text === undefined ? {} : { textKey: text.key, textManifestPath: text.manifestPath }) });
}

/** True when the job records a text plate for the shot: what a shot that no longer has one must drop. */
function recordsTextPlate(job: Job, shotId: string): boolean {
  const jobShot = findJobShot(job, shotId);
  return jobShot.textKey !== undefined || jobShot.textManifestPath !== undefined;
}

/** The result of a shot reused whole: its cache paths, every requested frame counted as reused, no time spent. */
function reusedResult(entry: PlannedShot, path: string): RenderShotResult {
  const directory = framesDir(entry.cacheDir);
  return { manifestPath: path, framesDir: directory, framePattern: framePattern(directory), frames: entry.frames.length, elapsedMs: 0, msPerFrame: 0, screenshotMsMedian: 0, reused: entry.frames.length };
}

/** The browser session of a run: opened once before the first browser shot or text plate, closed after the last. */
interface BrowserRun {
  /** Read only when a browser shot or a text plate is to render; a run of blender shots without text needs no browser. */
  readonly tools: RenderTools | undefined;
  readonly seams: RenderSeams;
  readonly pageDirectory: string;
  renderer: BrowserRenderer | undefined;
  harness: HarnessHandle | undefined;
  readonly fingerprints: Map<Lane, ManifestFingerprint>;
}

/** The run's browser as a text plate session; throws when the browser was not opened. */
function sessionOf(run: BrowserRun): TextPlateSession {
  if (run.renderer === undefined || run.harness === undefined || run.tools === undefined) throw new Error('The renderer was not opened.');
  return { renderer: run.renderer, harness: run.harness, seams: run.seams, tools: run.tools, pageDir: run.pageDirectory, fingerprint: run.fingerprints.get('html') };
}

/** Renders one browser shot through the run's browser. */
async function renderBrowserEntry(context: CommandContext, loaded: LoadedJob, spec: RenderSpec, run: BrowserRun, entry: PlannedShot): Promise<RenderShotResult> {
  const session = sessionOf(run);
  const { shot, key, frames, cacheDir } = entry;
  const lane = browserLaneOf(shot);
  const fingerprint = run.fingerprints.get(lane) ?? await run.seams.manifestFingerprint({ renderer: session.renderer, lane, ffmpegVersion: session.tools.ffmpeg.version, runner: context.runner, signal: context.signal });
  run.fingerprints.set(lane, fingerprint);
  return renderShot({
    renderer: session.renderer, page: run.seams, harnessUrl: session.harness.url, pageDir: run.pageDirectory, shot, look: loaded.look, spec, frames, cacheDir, key, fingerprint,
    runner: context.runner, ffmpegPath: session.tools.ffmpeg.path, log: context.log, signal: context.signal, now: context.now,
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

/** Renders (or reuses) the text plate of a shot right after its picture; undefined for a shot without one. */
async function renderTextPlateEntry(context: CommandContext, loaded: LoadedJob, spec: RenderSpec, run: BrowserRun, entry: PlannedShot, force: boolean): Promise<TextPlateOutcome | undefined> {
  const { shot, frames, textKey } = entry;
  if (textKey === undefined) return undefined;
  const cacheDir = shotCacheDir(context.dataDir, textKey);
  if (entry.textReuseWhole) {
    context.log.info(`${shot.id}  text plate  ${frames.length} frames already rendered; reused`);
    return { key: textKey, framePattern: framePattern(framesDir(cacheDir)), manifestPath: findJobShot(loaded.job, shot.id).textManifestPath ?? manifestPath(cacheDir), complete: true };
  }
  if (force && existsSync(cacheDir)) await removeDirectoryWithRetry(cacheDir);
  const session = sessionOf(run);
  const result = await renderTextPlate(session, context, { shot, look: loaded.look, spec, frames, key: textKey, cacheDir });
  if (session.fingerprint !== undefined) run.fingerprints.set('html', session.fingerprint);
  context.log.info(`${shot.id}  text plate  ${frames.length} frames  ${result.elapsedMs} ms  ${result.msPerFrame.toFixed(1)} ms/frame  ${result.reused} reused`);
  return { key: textKey, framePattern: result.framePattern, manifestPath: result.manifestPath, complete: isComplete(readManifest(result.manifestPath), shot.durationFrames) };
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
    const force = args.flag('force');
    const seams = await loadRealSeams();
    const spec: RenderSpec = { fps: loaded.shotSpec.fps, width: loaded.shotSpec.width, height: loaded.shotSpec.height };
    const planned = await planShots(context, loaded, selected, framesByShot, args, seams, spec.width, askedPolicy);
    const toRender = planned.filter((entry) => !entry.reuseWhole);
    // Only the browser shots this run renders pin the browser; a finished shot reused whole, a blender shot and a text plate have no say in it.
    const browserShots = toRender.filter((entry) => entry.shot.lane !== 'blender').map((entry) => entry.shot);
    const policy = effectivePolicy(askedPolicy, browserShots);
    const needsBrowser = browserShots.length > 0 || planned.some((entry) => entry.textKey !== undefined && !entry.textReuseWhole);
    const browserTools = needsBrowser ? readRenderTools(context.dataDir) : undefined;
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
        const { shot, frames, cacheDir } = entry;
        let result: RenderShotResult;
        let estimate: RenderEstimate | null = null;
        if (entry.reuseWhole) {
          // The counts are the requested frames, as for a rendered shot, so --frames a-b adds up the same either way.
          context.log.info(`${shot.id}  ${shot.lane}  ${frames.length} frames already rendered; reused`);
          result = reusedResult(entry, findJobShot(job, shot.id).manifestPath ?? manifestPath(cacheDir));
        } else {
          if (force && existsSync(cacheDir)) await removeDirectoryWithRetry(cacheDir);
          if (entry.blenderAttempt !== undefined && blenderTools !== undefined) {
            const rendered = await renderBlenderEntry(context, loaded, spec, blenderTools, entry, entry.blenderAttempt);
            result = rendered;
            estimate = rendered.estimate;
            if (estimate !== null) estimates.push({ estimate, frames: frames.length - result.reused });
          } else {
            result = await renderBrowserEntry(context, loaded, spec, run, entry);
          }
          context.log.info(`${shot.id}  ${shot.lane}  ${frames.length} frames  ${result.elapsedMs} ms  ${result.msPerFrame.toFixed(1)} ms/frame  ${result.reused} reused`);
        }
        const text = await renderTextPlateEntry(context, loaded, spec, run, entry, force);
        shots.push(shotData(entry, result, estimate, text));
        // A shot reused whole with its text plate reused too (or none to drop) leaves the job as it is, so its record keeps saying when the frames were made.
        if (entry.reuseWhole && (text === undefined ? !recordsTextPlate(job, shot.id) : entry.textReuseWhole)) continue;
        job = { ...recordRender(job, entry, result, text), status: 'rendering' };
        saveJob(loaded.folder, job);
      }
    } finally {
      if (run.renderer !== undefined) await run.renderer.close();
      if (run.harness !== undefined) await run.harness.stop();
    }
    const data: RenderData = { jobId: job.id, shots, skipped, totalFrames: shots.reduce((sum, shot) => sum + shot.frames, 0), elapsedMs: context.now().getTime() - started, estimate: combineEstimates(estimates) };
    return { data, artifacts: [], evidence: shots.flatMap((shot) => (shot.textManifestPath === null ? [shot.manifestPath] : [shot.manifestPath, shot.textManifestPath])) };
  },
};
