/**
 * `still --job <folder or job.json> --shot <id> [--frame <k>] [--renderer
 * hardware|software|any] [--scale <n>] [--approve]`: the still gate.
 *
 * One frame of the shot is rendered into the shot's cache (the same path
 * scheme render uses, so the frame is reused later), graded like the
 * delivery but without grain, written to `<job>/stills/<shot>-r<round>.png`
 * beside its raw frame, and judged by the three measured checks of the
 * gate. The renderer the browser gave is pinned into the shot spec and the
 * shot's key is recomputed with it (ADR 0004 decision 6, ADR 0006 decision
 * 8). The job records the still and the round whether or not the gate
 * passed; a failed gate is then reported with the files as evidence. With
 * --approve nothing renders: the latest still must have passed the gate,
 * and the shot becomes still-approved.
 */
import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UsageError, VisionForgeError } from '../../errors/vision-forge-error.ts';
import { ensureDirectory, removeDirectoryWithRetry } from '../../fs/paths.ts';
import type { BrowserRenderer } from '../../harness/types.ts';
import { shotKey } from '../../plan/shot-key.ts';
import { framePath, pageDir, shotCacheDir } from '../../render/cache.ts';
import { keyFingerprint, parseRendererPolicy, parseScale, parseStillFrame, readRenderTools } from '../../render/command-support.ts';
import { finishStill } from '../../render/finish-still.ts';
import { findJobShot, findShot, loadJob, pinRenderProfile, saveJob, updateShot, withRenderProfile } from '../../render/job-state.ts';
import type { LoadedJob } from '../../render/job-state.ts';
import { renderShot } from '../../render/render-shot.ts';
import { loadRealSeams } from '../../render/seams.ts';
import type { HarnessHandle, RenderSeams } from '../../render/seams.ts';
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

/** What the render of one still needs beyond the context. */
interface StillRender {
  readonly context: CommandContext;
  readonly seams: RenderSeams;
  readonly loaded: LoadedJob;
  readonly shot: Shot;
  readonly spec: RenderSpec;
  readonly frame: number;
  readonly ffmpegPath: string;
  readonly pageDirectory: string;
  readonly harness: HarnessHandle;
}

/** Renders the same frame at `scale` times the size in its own browser and grades it into the scaled still. */
async function renderScaledStill(render: StillRender, renderer: BrowserRenderer, scale: number, still: string): Promise<string> {
  const { context, seams, loaded, shot, spec, frame } = render;
  const scaledSpec: RenderSpec = { fps: spec.fps, width: spec.width * scale, height: spec.height * scale };
  const finished = scaledStillPath(still, scale);
  const raw = finished.replace(/\.png$/i, '.raw.png');
  // The harness serves one page directory; the scaled page replaces the 1x page there after the 1x frame is captured.
  seams.writeShotPage(render.pageDirectory, scaledSpec.width, scaledSpec.height);
  await renderer.capture({ pageUrl: seams.pageUrl(render.harness.url), spec: buildShotPageSpec(shot, loaded.look, scaledSpec), frames: [frame], framePath: (): string => raw }, context.signal);
  await finishStill(context.runner, render.ffmpegPath, raw, finished, loaded.look, context.signal);
  return finished;
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
    const lane = browserLaneOf(shot);
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
    const tools = readRenderTools(context.dataDir);
    const seams = await loadRealSeams();
    const { folder, look } = loaded;
    const spec: RenderSpec = { fps: loaded.shotSpec.fps, width: loaded.shotSpec.width, height: loaded.shotSpec.height };
    const frame = requestedFrame ?? defaultStillFrame(shot, spec.fps);
    const round = jobShot.rounds + 1;
    const paths = stillPaths(folder.dir, shotId, round);
    ensureDirectory(paths.stillsDir);
    ensureDirectory(paths.workDir);
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
        onInit: (report): void => { textOverflows = report.textOverflows; },
      });
      copyFileSync(framePath(result.framesDir, frame), paths.raw);
      await finishStill(context.runner, tools.ffmpeg.path, paths.raw, paths.still, look, context.signal);
      context.log.info(`wrote ${paths.still}`);

      let scaled: string | null = null;
      if (scale > 1) {
        await renderer.close();
        renderer = await seams.openRenderer({ browser: tools.browser, policy: profile.renderer, width: spec.width * scale, height: spec.height * scale, dataDir: context.dataDir, log: context.log, signal: context.signal });
        scaled = await renderScaledStill({ context, seams, loaded, shot: pinnedShot, spec, frame, ffmpegPath: tools.ffmpeg.path, pageDirectory, harness }, renderer, scale, paths.still);
        context.log.info(`wrote ${scaled}`);
      }

      const report = await runStillGate({ runner: context.runner, ffmpegPath: tools.ffmpeg.path, shot: pinnedShot, look, spec, finishedPng: paths.still, workDir: paths.workDir, signal: context.signal, ...(textOverflows === undefined ? {} : { textOverflows }) });
      const reportPath = gateReportPath(paths.still);
      for (const check of report.checks) context.log.info(`gate ${check.id}: ${check.ok ? 'ok' : 'FAILED'}; ${check.detail}`);
      const pinned = await pinRenderProfile(folder, loaded.shotSpec, shotId, profile, look, fingerprint);
      const job = updateShot(loaded.job, shotId, { status: 'still-rendered', stillPath: paths.still, rounds: round, key: pinned.key });
      // The job moves on to the stills stage once; a new round on one shot of a job already rendering does not move it back.
      saveJob(folder, { ...job, status: job.status === 'planned' ? 'stills' : job.status });
      if (!report.passed) throw new StillGateError(shotId, describeFailures(report), reportPath, paths.still);

      const data: StillData = {
        jobId: job.id, shotId, frame, stillPath: paths.still, rawStillPath: paths.raw, scaledStillPath: scaled, gateReportPath: reportPath,
        renderProfile: profile, passed: report.passed, checks: report.checks, round, msPerFrame: result.msPerFrame,
      };
      return { data, artifacts: scaled === null ? [paths.still] : [paths.still, scaled], evidence: [reportPath, paths.still] };
    } finally {
      if (renderer !== undefined) await renderer.close();
      if (harness !== undefined) await harness.stop();
      await removeDirectoryWithRetry(paths.workDir).catch((error: unknown) => { context.log.warn(`Could not remove ${paths.workDir}: ${error instanceof Error ? error.message : String(error)}`); });
    }
  },
};
