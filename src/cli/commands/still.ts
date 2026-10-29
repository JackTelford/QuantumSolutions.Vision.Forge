/**
 * `still --job <folder or job.json> --shot <id> [--frame <k>] [--renderer
 * hardware|software|any] [--scale <n>] [--approve]`: the still gate.
 *
 * One frame of the shot is rendered, graded like the delivery but without
 * grain, written to `<job>/stills/<shot>-r<round>.png` beside its raw
 * frame, and judged by the three measured checks of the gate. A browser
 * shot renders into the shot's cache (the same path scheme render uses, so
 * the frame is reused later) and the renderer the browser gave is pinned
 * into the shot spec. A blender shot runs the attempt ladder of ADR 0004
 * decision 6 (EEVEE on OpenGL, then Vulkan, then Cycles on OptiX, CUDA and
 * the CPU) into the round's scratch folder; the rung that rendered is
 * pinned, and render runs that rung alone. The still of a blender shot is
 * not cached, because a still renders with more samples than a clip. In
 * both cases the shot's key is recomputed with the profile (ADR 0006
 * decision 8). The job records the still and the round whether or not the
 * gate passed; a failed gate is then reported with the files as evidence.
 * With --approve nothing renders: the latest still must have passed the
 * gate, and the shot becomes still-approved.
 */
import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BlenderError } from '../../errors/blender-errors.ts';
import { UsageError, VisionForgeError } from '../../errors/vision-forge-error.ts';
import { ensureDirectory, removeDirectoryWithRetry } from '../../fs/paths.ts';
import type { BrowserRenderer, RendererPolicy } from '../../harness/types.ts';
import { runLadder, stillAttempts } from '../../lanes/blender/ladder.ts';
import { laneFingerprint, shotKey } from '../../plan/shot-key.ts';
import type { RenderFingerprint } from '../../plan/shot-key.ts';
import { blenderHdriPath } from '../../render/environment.ts';
import { blenderDeviceTypes, blenderFingerprint, readBlenderTools, realBlenderSeams, renderBlenderShot } from '../../render/blender-shot.ts';
import type { BlenderSceneSeams } from '../../render/blender-shot.ts';
import { framePath, pageDir, shotCacheDir } from '../../render/cache.ts';
import { keyFingerprint, parseRendererPolicy, parseScale, parseStillFrame, readRenderTools } from '../../render/command-support.ts';
import { finishStill } from '../../render/finish-still.ts';
import { findJobShot, findShot, loadJob, pinRenderProfile, saveJob, updateShot, withRenderProfile } from '../../render/job-state.ts';
import type { LoadedJob } from '../../render/job-state.ts';
import { renderShot } from '../../render/render-shot.ts';
import { loadRealSeams } from '../../render/seams.ts';
import type { HarnessHandle, RenderSeams } from '../../render/seams.ts';
import { resolveEnvironment } from '../../render/environment.ts';
import { browserLaneOf, buildShotPageSpec } from '../../render/shot-page-spec.ts';
import { StillGateError } from '../../render/still-gate-error.ts';
import { describeFailures, gateReportPath, readGateReport, runStillGate } from '../../render/still-gate.ts';
import type { StillGateCheck } from '../../render/still-gate.ts';
import { defaultStillFrame } from '../../render/still-frame.ts';
import { reviewRoundCap } from '../../schema/checks/job.ts';
import type { RenderSpec } from '../../shared/camera/types.ts';
import type { RenderProfile, Shot } from '../../shared/contracts/shot-spec.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { TextOverflow } from '../../shared/harness/protocol.ts';
import type { Command, CommandContext } from '../command.ts';
import type { CommandOutput } from '../result.ts';

/** Shape of the still payload. */
export interface StillData {
  readonly jobId: string;
  readonly shotId: string;
  /** The frame the still shows. */
  readonly frame: number;
  readonly stillPath: string;
  readonly rawStillPath: string;
  /** The still at --scale times the frame size; null without --scale. */
  readonly scaledStillPath: string | null;
  readonly gateReportPath: string;
  readonly renderProfile: RenderProfile;
  readonly passed: boolean;
  readonly checks: readonly StillGateCheck[];
  /** The review round this still belongs to, counted from 1. */
  readonly round: number;
  readonly msPerFrame: number;
}

/** Shape of the --approve payload. */
export interface ApproveData {
  readonly jobId: string;
  readonly shotId: string;
  readonly status: 'still-approved';
}

/** The files of one review round under `<job>/stills/`. */
export interface StillPaths {
  readonly stillsDir: string;
  readonly still: string;
  readonly raw: string;
  readonly workDir: string;
}

/** The still, raw frame and scratch paths of a shot's review round. */
export function stillPaths(jobDir: string, shotId: string, round: number): StillPaths {
  const stillsDir = join(jobDir, 'stills');
  return { stillsDir, still: join(stillsDir, `${shotId}-r${round}.png`), raw: join(stillsDir, `${shotId}-r${round}.raw.png`), workDir: join(stillsDir, `.work-${shotId}-r${round}`) };
}

/** The scaled still's path: the still's name with `-<n>x` before the extension. */
export function scaledStillPath(still: string, scale: number): string {
  return still.replace(/\.png$/i, `-${scale}x.png`);
}

/** Marks the latest still approved; the shot must be still-rendered and its gate report passed. */
function approve(loaded: LoadedJob, shotId: string): CommandOutput {
  const jobShot = findJobShot(loaded.job, shotId);
  if (jobShot.status !== 'still-rendered' || jobShot.stillPath === null) {
    throw new VisionForgeError({
      code: 'still-not-rendered',
      message: `Shot "${shotId}" has no still to approve; its status is ${jobShot.status}.`,
      hint: `Run still --job ${loaded.folder.dir} --shot ${shotId} first and look at the still before approving it.`,
    });
  }
  const reportPath = gateReportPath(jobShot.stillPath);
  const report = readGateReport(reportPath);
  if (!report.passed) throw new StillGateError(shotId, describeFailures(report), reportPath, jobShot.stillPath);
  saveJob(loaded.folder, updateShot(loaded.job, shotId, { status: 'still-approved' }));
  const data: ApproveData = { jobId: loaded.job.id, shotId, status: 'still-approved' };
  return { data, artifacts: [], evidence: [reportPath] };
}

/** What both lanes share once a round's still is rendered: the gate, the pin, the job update and the payload. */
interface StillRound {
  readonly context: CommandContext;
  readonly loaded: LoadedJob;
  readonly shotId: string;
  /** The shot with the profile that rendered it pinned. */
  readonly pinnedShot: Shot;
  readonly spec: RenderSpec;
  readonly frame: number;
  readonly round: number;
  readonly paths: StillPaths;
  readonly ffmpegPath: string;
  readonly profile: RenderProfile;
  readonly fingerprint: RenderFingerprint;
  readonly scaled: string | null;
  readonly msPerFrame: number;
  readonly textOverflows?: readonly TextOverflow[];
}

/** Runs the gate on the finished still, pins the profile, records the round on the job and returns the payload; a failed gate throws after the files are written. */
async function gateAndPin(round: StillRound): Promise<CommandOutput> {
  const { context, loaded, shotId, pinnedShot, spec, paths, profile } = round;
  const report = await runStillGate({ runner: context.runner, ffmpegPath: round.ffmpegPath, shot: pinnedShot, look: loaded.look, spec, finishedPng: paths.still, workDir: paths.workDir, signal: context.signal, ...(round.textOverflows === undefined ? {} : { textOverflows: round.textOverflows }) });
  const reportPath = gateReportPath(paths.still);
  for (const check of report.checks) context.log.info(`gate ${check.id}: ${check.ok ? 'ok' : 'FAILED'}; ${check.detail}`);
  const pinned = await pinRenderProfile(loaded.folder, loaded.shotSpec, shotId, profile, loaded.look, round.fingerprint);
  const job = updateShot(loaded.job, shotId, { status: 'still-rendered', stillPath: paths.still, rounds: round.round, key: pinned.key });
  // The job moves on to the stills stage once; a new round on one shot of a job already rendering does not move it back.
  saveJob(loaded.folder, { ...job, status: job.status === 'planned' ? 'stills' : job.status });
  if (!report.passed) throw new StillGateError(shotId, describeFailures(report), reportPath, paths.still);
  const data: StillData = {
    jobId: job.id, shotId, frame: round.frame, stillPath: paths.still, rawStillPath: paths.raw, scaledStillPath: round.scaled, gateReportPath: reportPath,
    renderProfile: profile, passed: report.passed, checks: report.checks, round: round.round, msPerFrame: round.msPerFrame,
  };
  return { data, artifacts: round.scaled === null ? [paths.still] : [paths.still, round.scaled], evidence: [reportPath, paths.still] };
}

/** What the render of one still needs beyond the context. */
interface StillRender {
  readonly context: CommandContext;
  readonly loaded: LoadedJob;
  readonly shot: Shot;
  readonly spec: RenderSpec;
  readonly frame: number;
  readonly round: number;
  readonly paths: StillPaths;
  readonly policy: RendererPolicy;
  readonly scale: number;
}

/** Renders the same frame at `scale` times the size in its own browser and grades it into the scaled still. */
async function renderScaledStill(render: StillRender & { readonly seams: RenderSeams; readonly pageDirectory: string; readonly harness: HarnessHandle; readonly ffmpegPath: string }, renderer: BrowserRenderer, still: string): Promise<string> {
  const { context, seams, loaded, shot, spec, frame, scale } = render;
  const scaledSpec: RenderSpec = { fps: spec.fps, width: spec.width * scale, height: spec.height * scale };
  const finished = scaledStillPath(still, scale);
  const raw = finished.replace(/\.png$/i, '.raw.png');
  // The harness serves one page directory; the scaled page replaces the 1x page there after the 1x frame is captured.
  seams.writeShotPage(render.pageDirectory, scaledSpec.width, scaledSpec.height);
  await renderer.capture({ pageUrl: seams.pageUrl(render.harness.url), spec: buildShotPageSpec(shot, loaded.look, scaledSpec, resolveEnvironment(shot, context.dataDir)), frames: [frame], framePath: (): string => raw }, context.signal);
  await finishStill(context.runner, render.ffmpegPath, raw, finished, loaded.look, context.signal);
  return finished;
}

/** The browser path: one browser, the frame into the shot's cache, the profile the browser gave. */
async function renderBrowserStill(render: StillRender): Promise<CommandOutput> {
  const { context, loaded, shot, spec, frame, round, paths, policy, scale } = render;
  const shotId = shot.id;
  const lane = browserLaneOf(shot);
  const tools = readRenderTools(context.dataDir);
  const seams = await loadRealSeams();
  const { look } = loaded;
  context.log.info(`still of shot "${shotId}" (${lane}) at frame ${frame}, round ${round}, with ${tools.browser.channel} ${tools.browser.version}`);
  let renderer: BrowserRenderer | undefined;
  let harness: HarnessHandle | undefined;
  try {
    renderer = await seams.openRenderer({ browser: tools.browser, policy, width: spec.width, height: spec.height, dataDir: context.dataDir, log: context.log, signal: context.signal });
    const profile = renderer.profile;
    context.log.info(`renderer: ${profile.renderer} (${profile.engine}, ${profile.backend})`);
    // The profile enters the key, so the still is rendered under the key render will look up, and pinning it below changes nothing.
    const fingerprint = await keyFingerprint(context.dataDir, lane, seams);
    const pinnedShot = findShot(withRenderProfile(loaded.shotSpec, shotId, profile), shotId);
    const key = await shotKey(pinnedShot, look, fingerprint);
    const cacheDir = shotCacheDir(context.dataDir, key);
    const pageDirectory = ensureDirectory(pageDir(cacheDir));
    harness = await seams.startHarness({ pageDir: pageDirectory, dataDir: context.dataDir, log: context.log, signal: context.signal });
    const manifestFingerprint = await seams.manifestFingerprint({ renderer, lane, ffmpegVersion: tools.ffmpeg.version, runner: context.runner, signal: context.signal });
    let textOverflows: readonly TextOverflow[] | undefined;
    const result = await renderShot({
      renderer, page: seams, harnessUrl: harness.url, pageDir: pageDirectory, shot: pinnedShot, look, spec, frames: [frame], cacheDir, key,
      fingerprint: manifestFingerprint, runner: context.runner, ffmpegPath: tools.ffmpeg.path, log: context.log, signal: context.signal, now: context.now,
      environment: resolveEnvironment(pinnedShot, context.dataDir),
      onInit: (report): void => { textOverflows = report.textOverflows; },
    });
    copyFileSync(framePath(result.framesDir, frame), paths.raw);
    await finishStill(context.runner, tools.ffmpeg.path, paths.raw, paths.still, look, context.signal);
    context.log.info(`wrote ${paths.still}`);

    let scaled: string | null = null;
    if (scale > 1) {
      await renderer.close();
      renderer = await seams.openRenderer({ browser: tools.browser, policy: profile.renderer, width: spec.width * scale, height: spec.height * scale, dataDir: context.dataDir, log: context.log, signal: context.signal });
      scaled = await renderScaledStill({ ...render, shot: pinnedShot, seams, pageDirectory, harness, ffmpegPath: tools.ffmpeg.path }, renderer, paths.still);
      context.log.info(`wrote ${scaled}`);
    }
    return await gateAndPin({ context, loaded, shotId, pinnedShot, spec, frame, round, paths, ffmpegPath: tools.ffmpeg.path, profile, fingerprint, scaled, msPerFrame: result.msPerFrame, ...(textOverflows === undefined ? {} : { textOverflows }) });
  } finally {
    if (renderer !== undefined) await renderer.close();
    if (harness !== undefined) await harness.stop();
    await removeDirectoryWithRetry(paths.workDir).catch((error: unknown) => { context.log.warn(`Could not remove ${paths.workDir}: ${error instanceof Error ? error.message : String(error)}`); });
  }
}

/** What one Blender render of a still frame needs. */
interface BlenderStillFrame {
  readonly render: StillRender;
  readonly seams: BlenderSceneSeams;
  readonly spec: RenderSpec;
  readonly fingerprint: RenderFingerprint;
  readonly blenderPath: string;
  readonly blenderVersion: string;
  readonly ffmpegPath: string;
  readonly ffmpegVersion: string;
  readonly hdriPath: string | null;
  /** The scratch folder the attempts render under. */
  readonly workDir: string;
}

/** Runs the ladder for one frame at one size; each attempt renders into its own folder under the scratch dir and the winner's frame path, shot and key come back. */
async function renderBlenderFrame(input: BlenderStillFrame, policy: RendererPolicy, deviceTypes: readonly string[], interactiveSession: boolean): Promise<{ readonly profile: RenderProfile; readonly pinnedShot: Shot; readonly framePath: string; readonly msPerFrame: number }> {
  const { render, spec } = input;
  const { context, loaded, shot, frame } = render;
  const attempts = stillAttempts({ width: spec.width, deviceTypes, interactiveSession, policy });
  context.log.info(`blender ladder for ${spec.width}x${spec.height}: ${attempts.map((attempt) => attempt.name).join(', ') || 'nothing'}`);
  const outcome = await runLadder(attempts, async (attempt) => {
    const pinnedShot = findShot(withRenderProfile(loaded.shotSpec, shot.id, attempt.profile), shot.id);
    const key = await shotKey(pinnedShot, loaded.look, input.fingerprint);
    const result = await renderBlenderShot({
      seams: input.seams, shot: pinnedShot, look: loaded.look, spec, frames: [frame], cacheDir: join(input.workDir, attempt.name), key,
      fingerprint: blenderFingerprint(input.blenderVersion, input.ffmpegVersion), attempt, blenderPath: input.blenderPath, dataDir: context.dataDir, hdriPath: input.hdriPath,
      runner: context.runner, ffmpegPath: input.ffmpegPath, log: context.log, signal: context.signal, now: context.now,
    });
    return { pinnedShot, framePath: framePath(result.framesDir, frame), msPerFrame: result.msPerFrame };
  }, context.log);
  return { profile: outcome.attempt.profile, ...outcome.value };
}

/** The blender path: the ladder into the scratch folder, the winning rung pinned; a failed ladder keeps the scratch folder with Blender's logs. */
async function renderBlenderStill(render: StillRender): Promise<CommandOutput> {
  const { context, loaded, shot, spec, frame, round, paths, policy, scale } = render;
  const tools = readBlenderTools(context.dataDir);
  const seams: BlenderSceneSeams = realBlenderSeams;
  const fingerprint = await laneFingerprint(context.dataDir, 'blender');
  const deviceTypes = blenderDeviceTypes(tools.blender);
  const hdriPath = blenderHdriPath(shot, context.dataDir);
  context.log.info(`still of shot "${shot.id}" (blender) at frame ${frame}, round ${round}, with Blender ${tools.blender.version}; HDRI ${hdriPath ?? 'none installed (flat world)'}`);
  const common = { render, seams, fingerprint, blenderPath: tools.blender.path, blenderVersion: tools.blender.version, ffmpegPath: tools.ffmpeg.path, ffmpegVersion: tools.ffmpeg.version, hdriPath };
  let keepWorkDir = false;
  try {
    const first = await renderBlenderFrame({ ...common, spec, workDir: join(paths.workDir, 'blender') }, policy, deviceTypes, tools.interactiveSession);
    copyFileSync(first.framePath, paths.raw);
    await finishStill(context.runner, tools.ffmpeg.path, paths.raw, paths.still, loaded.look, context.signal);
    context.log.info(`wrote ${paths.still}`);
    let scaled: string | null = null;
    if (scale > 1) {
      // The hero still runs the ladder at its own size: at 4K width the EEVEE rungs drop out and Cycles denoises (ADR 0004 decision 6).
      const scaledSpec: RenderSpec = { fps: spec.fps, width: spec.width * scale, height: spec.height * scale };
      const hero = await renderBlenderFrame({ ...common, spec: scaledSpec, workDir: join(paths.workDir, 'blender-scaled') }, first.profile.renderer, deviceTypes, tools.interactiveSession);
      scaled = scaledStillPath(paths.still, scale);
      const raw = scaled.replace(/\.png$/i, '.raw.png');
      copyFileSync(hero.framePath, raw);
      await finishStill(context.runner, tools.ffmpeg.path, raw, scaled, loaded.look, context.signal);
      context.log.info(`wrote ${scaled}`);
    }
    return await gateAndPin({ context, loaded, shotId: shot.id, pinnedShot: first.pinnedShot, spec, frame, round, paths, ffmpegPath: tools.ffmpeg.path, profile: first.profile, fingerprint, scaled, msPerFrame: first.msPerFrame });
  } catch (error: unknown) {
    if (error instanceof BlenderError || (error instanceof VisionForgeError && error.code === 'blender-render')) {
      keepWorkDir = true;
      context.log.warn(`Blender's scene documents and logs are kept under ${paths.workDir}`);
    }
    throw error;
  } finally {
    if (!keepWorkDir) await removeDirectoryWithRetry(paths.workDir).catch((error: unknown) => { context.log.warn(`Could not remove ${paths.workDir}: ${error instanceof Error ? error.message : String(error)}`); });
  }
}

/** The still command. */
export const command: Command = {
  name: 'still',
  summary: 'Render one frame of a shot, grade it, run the still gate and pin the render profile; --approve marks a passed still approved.',
  options: { strings: ['job', 'shot', 'frame', 'renderer', 'scale'], flags: ['approve'] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const loaded = loadJob(resolve(context.cwd, args.requireString('job', 'the job folder (or its job.json) the plan command wrote')));
    const shotId = args.requireString('shot', 'the id of the shot, as the shot spec names it');
    const shot = findShot(loaded.shotSpec, shotId);
    if (args.flag('approve')) {
      // Approving renders nothing, so a render option beside it is a mistake worth naming rather than ignoring.
      if ((args.string('frame') ?? args.string('scale') ?? args.string('renderer')) !== undefined) {
        throw new UsageError('--approve takes no --frame, --scale or --renderer.', 'Approve the still already rendered, or run still without --approve to render another.');
      }
      return approve(loaded, shotId);
    }
    const requestedFrame = parseStillFrame(args.number('frame'), shot);
    const policy = parseRendererPolicy(args.string('renderer'));
    const scale = parseScale(args.number('scale'));
    const jobShot = findJobShot(loaded.job, shotId);
    if (jobShot.rounds >= reviewRoundCap) {
      throw new VisionForgeError({
        code: 'still-rounds',
        message: `Shot "${shotId}" has had ${jobShot.rounds} still review rounds, the cap.`,
        hint: 'Change the shot spec or the look so the shot gets a new key, or plan again; the cap keeps a shot from being tuned forever.',
      });
    }
    const spec: RenderSpec = { fps: loaded.shotSpec.fps, width: loaded.shotSpec.width, height: loaded.shotSpec.height };
    const frame = requestedFrame ?? defaultStillFrame(shot, spec.fps);
    const round = jobShot.rounds + 1;
    const paths = stillPaths(loaded.folder.dir, shotId, round);
    ensureDirectory(paths.stillsDir);
    ensureDirectory(paths.workDir);
    const render: StillRender = { context, loaded, shot, spec, frame, round, paths, policy, scale };
    return shot.lane === 'blender' ? renderBlenderStill(render) : renderBrowserStill(render);
  },
};
