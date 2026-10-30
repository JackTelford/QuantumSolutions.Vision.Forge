/**
 * `qa`: measures a delivery and writes a QA report.
 *
 * `--video <file>` is the delivery. With `--plan <file>` the dimensions, fps
 * and duration are held to the plan, planned cuts are not pops, planned
 * fades to black are not black frames and the last half second of a clip
 * may hold still. `--text-boxes <file>` adds the text-contrast check,
 * `--still <png> --still-frame <k>` the hero-still-match check. The report
 * goes to `--report <file>` or `<out>/qa/<video name>.qa.json`. A failed
 * check exits 1 with code qa-failed unless `--no-fail` is given.
 *
 * `--job <folder or job.json>` takes all of that from the job `assemble
 * --job` finished: the delivery and the plan it recorded, one text box per
 * text element of every shot at the clip's first frame and at the frame the
 * still gate judged (offset to the delivery timeline), and every shot's
 * approved still against the delivery frame it was rendered for, except
 * where that frame lies inside a transition (a warning names the shot and
 * the report carries a hero-still-match entry that says it was not
 * compared). The report goes to `<job>/qa/<jobId>.qa.json`; the job becomes
 * `delivered` when every check passes and `failed` otherwise.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { JobNotAssembledError } from '../../errors/job-errors.ts';
import { DataFileError, UsageError } from '../../errors/vision-forge-error.ts';
import { checkAudio, defaultLoudnessTarget, defaultTruePeakCeiling } from '../../qa/audio-checks.ts';
import { makeCheck } from '../../qa/check.ts';
import type { Analysis } from '../../qa/check.ts';
import { checkDimensions, checkDuration, checkFps, expectationsFromPlan } from '../../qa/expectation-checks.ts';
import { checkExposureDrift } from '../../qa/exposure.ts';
import { checkBlackFrames, checkFrozenFrames, checkPops } from '../../qa/motion-checks.ts';
import { holdShotIds, planContext } from '../../qa/plan-context.ts';
import type { PlanContext } from '../../qa/plan-context.ts';
import { probeVideo } from '../../qa/probe.ts';
import { QaFailedError } from '../../qa/qa-failed-error.ts';
import { buildQaReport, failedCheckIds, writeQaReport } from '../../qa/report.ts';
import { checkHeroStillAgainstRender, checkHeroStillMatch, heroStillThreshold } from '../../qa/still-match.ts';
import { checkTextContrast, readTextBoxes } from '../../qa/text-contrast.ts';
import type { TextBox } from '../../qa/text-contrast.ts';
import { loadJob, saveJob, withStatus } from '../../render/job-state.ts';
import type { LoadedJob } from '../../render/job-state.ts';
import { framePath, framesDir } from '../../render/cache.ts';
import { defaultStillFrame } from '../../render/still-frame.ts';
import { clipStartFrames } from '../../schema/checks/assembly-plan.ts';
import type { AssemblyPlan } from '../../shared/contracts/assembly-plan.ts';
import type { LookBible } from '../../shared/contracts/look-bible.ts';
import type { Check, CheckId } from '../../shared/contracts/qa-report.ts';
import type { ShotSpec } from '../../shared/contracts/shot-spec.ts';
import { requireFfmpeg, requireFfprobe } from '../../tools/ffmpeg.ts';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';
import { jobAssemblyFileNames, loadAssemblyPlan } from './assemble.ts';

/** Shape of the qa payload. */
export interface QaData {
  /** Absolute path of the report that was written. */
  readonly reportPath: string;
  readonly passed: boolean;
  /** Ids of the checks that failed, each once, in report order. */
  readonly failed: readonly CheckId[];
}

/** One approved still of a job and the delivery frame it was rendered for. */
export interface ShotStill {
  readonly shotId: string;
  /** The approved still's raw frame, before the grade. */
  readonly path: string;
  /** Frame k of the shot's render in the cache. */
  readonly framePath: string;
  /** The frame the still gate judged, counted inside the shot. */
  readonly frame: number;
}

/** A shot of a job whose still is not compared, and why; the report carries it so a reader sees which shots went unjudged. */
export interface SkippedStill {
  readonly shotId: string;
  readonly reason: string;
}

/** Everything the command resolved from its arguments. */
export interface QaRequest {
  readonly videoPath: string;
  readonly plan: PlanContext | undefined;
  readonly textBoxes: readonly TextBox[] | undefined;
  readonly still: { readonly path: string; readonly frame: number } | undefined;
  /** The approved stills of a job, one hero-still-match check each; empty without --job. */
  readonly shotStills: readonly ShotStill[];
  /** The shots of a job left out of the hero comparison, one passing hero-still-match entry each that says why; empty without --job. */
  readonly skippedStills: readonly SkippedStill[];
  /** The job the delivery belongs to, when --job named it; its status moves after the checks. */
  readonly job: LoadedJob | undefined;
  readonly reportPath: string;
  readonly loudnessTarget: number;
  readonly truePeakCeiling: number;
  readonly noFail: boolean;
}

/** Where the report goes when --report is absent: <out>/qa/<video name>.qa.json. */
export function defaultReportPath(outDir: string, videoPath: string): string {
  return join(outDir, 'qa', `${basename(videoPath, extname(videoPath))}.qa.json`);
}

/** Where a job's report goes when --report is absent: <job>/qa/<jobId>.qa.json. */
export function jobReportPath(jobDir: string, jobId: string): string {
  return join(jobDir, 'qa', `${jobId}.qa.json`);
}

function requireExisting(path: string, what: string): string {
  if (!existsSync(path)) throw new DataFileError(path, 'the file does not exist', `Pass the path of ${what}, absolute or relative to the working directory.`);
  return path;
}

/** The delivery frame each shot's clip starts on, by shot id; a shot the plan has no clip for means the plan is not this job's. */
function clipStartsByShot(plan: AssemblyPlan, shotSpec: ShotSpec, planPath: string): ReadonlyMap<string, number> {
  const starts = clipStartFrames(plan);
  const byId = new Map(plan.clips.map((clip, index) => [clip.id, starts[index] ?? 0] as const));
  for (const shot of shotSpec.shots) {
    if (!byId.has(shot.id)) throw new DataFileError(planPath, `the plan has no clip for shot "${shot.id}"`, 'Run assemble --job again; it rebuilds the plan from the job\'s shots.');
  }
  return byId;
}

/** Every text element of every shot as a text box at the clip's first frame and at the frame the still gate judged, offset to the delivery timeline. */
export function jobTextBoxes(plan: AssemblyPlan, shotSpec: ShotSpec, look: LookBible, planPath: string): TextBox[] {
  const starts = clipStartsByShot(plan, shotSpec, planPath);
  const boxes: TextBox[] = [];
  for (const shot of shotSpec.shots) {
    const start = starts.get(shot.id) ?? 0;
    // A set, since a still frame of 0 would name the clip's first frame twice.
    const frames = new Set([start, start + defaultStillFrame(shot, shotSpec.fps)]);
    for (const element of shot.text) {
      for (const frame of frames) boxes.push({ frame, box: { ...element.box }, textColor: look.palette.text });
    }
  }
  return boxes;
}

/** What the job offers the hero comparison: the stills to compare, and the shots left out with the reason for each. */
export interface JobStills {
  readonly stills: readonly ShotStill[];
  readonly skipped: readonly SkippedStill[];
}

/**
 * Every shot's latest approved still, as its raw frame, paired with frame k
 * of the shot's render in the cache: the comparison of ADR 0006 decision 7,
 * before the grade, the grain and the encode (a delivery frame after x264
 * and grain measured 0.85 to 0.94 planar-RGB SSIM against the still on the
 * first product film while the render frame measured 0.99997). A shot
 * without a still or a manifest is left out with the reason.
 */
export function jobShotStills(loaded: LoadedJob): JobStills {
  const stills: ShotStill[] = [];
  const skipped: SkippedStill[] = [];
  for (const shot of loaded.shotSpec.shots) {
    const entry = loaded.job.shots.find((candidate) => candidate.id === shot.id);
    const stillPath = entry?.stillPath ?? null;
    const manifestPath = entry?.manifestPath ?? null;
    if (stillPath === null) {
      skipped.push({ shotId: shot.id, reason: 'the job records no still for it' });
      continue;
    }
    if (manifestPath === null) {
      skipped.push({ shotId: shot.id, reason: 'the job records no render manifest for it' });
      continue;
    }
    const frame = defaultStillFrame(shot, loaded.shotSpec.fps);
    stills.push({ shotId: shot.id, path: rawStillOf(stillPath), framePath: framePath(framesDir(dirname(manifestPath)), frame), frame });
  }
  return { stills, skipped };
}

/** The raw frame the still command keeps beside a finished still: `<shot>-r<n>.raw.png`. */
export function rawStillOf(stillPath: string): string {
  return stillPath.replace(/\.png$/i, '.raw.png');
}

/** The request for a job: the delivery and the plan assemble recorded, the text boxes and the stills from the shot spec and the job. */
function requestFromJob(context: CommandContext, args: ParsedArguments, jobArg: string): QaRequest {
  for (const option of ['video', 'plan', 'text-boxes', 'still', 'still-frame']) {
    if (args.string(option) !== undefined) throw new UsageError(`--${option} does not go with --job.`, '--job takes the delivery, the plan, the text boxes and the stills from the job folder; pass --job alone (with --report, --loudness-target or --no-fail).');
  }
  const loaded = loadJob(resolve(context.cwd, jobArg));
  const { folder, job } = loaded;
  // assemble forgets the delivery when it starts; a job still at assembling had its run cut short, whatever file is left in the folder.
  if (job.status === 'assembling') throw new JobNotAssembledError(job.id, 'the last assemble did not finish', folder.dir);
  if (job.deliverablePath === null) throw new JobNotAssembledError(job.id, `its status is ${job.status} and it records no delivery`, folder.dir);
  if (!existsSync(job.deliverablePath)) throw new JobNotAssembledError(job.id, `the delivery ${job.deliverablePath} does not exist`, folder.dir);
  const planPath = join(folder.dir, jobAssemblyFileNames.plan);
  if (!existsSync(planPath)) throw new JobNotAssembledError(job.id, `${planPath} does not exist`, folder.dir);
  const plan = loadAssemblyPlan(planPath);
  const reportOption = args.string('report');
  const jobStills = jobShotStills(loaded);
  for (const entry of jobStills.skipped) context.log.warn(`qa: shot "${entry.shotId}" has no hero comparison: ${entry.reason}`);
  return {
    videoPath: job.deliverablePath,
    plan: planContext(plan, holdShotIds(loaded.shotSpec.shots)),
    textBoxes: jobTextBoxes(plan, loaded.shotSpec, loaded.look, planPath),
    still: undefined,
    shotStills: jobStills.stills,
    skippedStills: jobStills.skipped,
    job: loaded,
    reportPath: reportOption === undefined ? jobReportPath(folder.dir, job.id) : resolve(context.cwd, reportOption),
    loudnessTarget: args.number('loudness-target') ?? plan.audio?.loudnessLufs ?? defaultLoudnessTarget,
    truePeakCeiling: plan.audio?.truePeakDbtp ?? defaultTruePeakCeiling,
    noFail: args.flag('no-fail'),
  };
}

/** Resolves the arguments into a request; usage errors name the option. */
export function parseRequest(context: CommandContext, args: ParsedArguments): QaRequest {
  const jobArg = args.string('job');
  if (jobArg !== undefined) return requestFromJob(context, args, jobArg);
  const videoPath = requireExisting(resolve(context.cwd, args.requireString('video', 'the delivery file to check')), 'the delivery video');
  const planPath = args.string('plan');
  const plan = planPath === undefined ? undefined : planContext(loadAssemblyPlan(requireExisting(resolve(context.cwd, planPath), 'the assembly plan')));
  const boxesPath = args.string('text-boxes');
  const textBoxes = boxesPath === undefined ? undefined : readTextBoxes(requireExisting(resolve(context.cwd, boxesPath), 'the text boxes JSON'));
  const stillPath = args.string('still');
  const stillFrame = args.number('still-frame');
  if (stillFrame !== undefined && stillPath === undefined) throw new UsageError('--still-frame needs --still.', 'Pass --still <png> with the approved still to compare against that frame.');
  if (stillPath !== undefined && stillFrame === undefined) throw new UsageError('--still needs --still-frame.', 'Pass --still-frame <integer>: the delivery frame the approved still was rendered from.');
  if (stillFrame !== undefined && (!Number.isInteger(stillFrame) || stillFrame < 0)) throw new UsageError(`--still-frame must be a frame number of 0 or more, got ${stillFrame}.`, 'Pass --still-frame <integer>.');
  const still = stillPath === undefined || stillFrame === undefined ? undefined : { path: requireExisting(resolve(context.cwd, stillPath), 'the approved still'), frame: stillFrame };
  const reportOption = args.string('report');
  return {
    videoPath,
    plan,
    textBoxes,
    still,
    shotStills: [],
    skippedStills: [],
    job: undefined,
    reportPath: reportOption === undefined ? defaultReportPath(context.outDir, videoPath) : resolve(context.cwd, reportOption),
    loudnessTarget: args.number('loudness-target') ?? plan?.loudnessLufs ?? defaultLoudnessTarget,
    truePeakCeiling: plan?.truePeakDbtp ?? defaultTruePeakCeiling,
    noFail: args.flag('no-fail'),
  };
}

/** Runs every check that applies, in report order, logging each verdict. */
export async function runChecks(context: CommandContext, request: QaRequest, ffmpegPath: string, ffprobePath: string): Promise<Check[]> {
  const probe = await probeVideo(context.runner, ffprobePath, request.videoPath, context.signal);
  context.log.info(`qa: ${request.videoPath} is ${probe.width}x${probe.height} at ${probe.fps} fps, ${probe.frameCount} frames, ${probe.codec} ${probe.pixFmt}`);
  const workDir = mkdtempSync(join(tmpdir(), 'vf-qa-'));
  const checks: Check[] = [];
  const record = (check: Check): void => {
    checks.push(check);
    context.log.info(`qa: ${check.id} ${check.ok ? 'ok' : 'FAILED'}: ${check.detail}`);
  };
  try {
    const analysis: Analysis = { runner: context.runner, ffmpegPath, videoPath: request.videoPath, probe, workDir, signal: context.signal };
    const expected = request.plan === undefined ? {} : expectationsFromPlan(request.plan);
    record(checkDimensions(probe, expected));
    record(checkFps(probe, expected));
    record(checkDuration(probe, expected));
    record(await checkBlackFrames(analysis, request.plan));
    record(await checkFrozenFrames(analysis, request.plan));
    record(await checkPops(analysis, request.plan));
    record(await checkExposureDrift(analysis, request.plan));
    if (request.textBoxes !== undefined) record(await checkTextContrast(analysis, request.textBoxes));
    const [loudness, truePeak] = await checkAudio(context.runner, ffmpegPath, ffprobePath, request.videoPath, request.loudnessTarget, request.truePeakCeiling, context.signal);
    record(loudness);
    record(truePeak);
    if (request.still !== undefined) record(await checkHeroStillMatch(context.runner, ffmpegPath, request.still.path, request.videoPath, request.still.frame, workDir, context.signal));
    // One hero comparison per shot of a job; the check's detail names the still file, which carries the shot id.
    for (const still of request.shotStills) record(await checkHeroStillAgainstRender(context.runner, ffmpegPath, still.path, still.framePath, still.frame, context.signal));
    // A shot left out is not a failure (nothing was measured), but the report must say it went uncompared rather than stay silent.
    for (const entry of request.skippedStills) record(makeCheck('hero-still-match', { ok: true, measured: null, threshold: heroStillThreshold, unit: 'ssim', detail: `shot "${entry.shotId}" not compared: ${entry.reason}`, frames: [] }));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  return checks;
}

/** The qa command. */
export const command: Command = {
  name: 'qa',
  summary: 'Measure a delivery (black and frozen frames, pops, exposure, text contrast, loudness, hero stills) and write a QA report; --job takes everything from the assembled job.',
  options: { strings: ['video', 'job', 'plan', 'text-boxes', 'still', 'still-frame', 'report', 'loudness-target'], flags: ['no-fail'] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const request = parseRequest(context, args);
    const ffmpegPath = requireFfmpeg();
    const ffprobePath = requireFfprobe();
    const checks = await runChecks(context, request, ffmpegPath, ffprobePath);
    const report = buildQaReport({ kind: 'deliverable', path: request.videoPath, shotId: null }, checks, [], context.now());
    writeQaReport(request.reportPath, report);
    const failed = failedCheckIds(checks);
    context.log.info(`qa: ${report.passed ? 'passed' : `failed ${failed.join(', ')}`}; report at ${request.reportPath}`);
    if (request.job !== undefined) {
      // The job's last move: delivered on a clean report, failed otherwise (whatever --no-fail says about the exit code).
      saveJob(request.job.folder, withStatus(request.job.job, report.passed ? 'delivered' : 'failed'));
      context.log.info(`job ${request.job.job.id} is ${report.passed ? 'delivered' : 'failed'}`);
    }
    if (!report.passed && !request.noFail) throw new QaFailedError(failed, request.reportPath);
    const data: QaData = { reportPath: request.reportPath, passed: report.passed, failed };
    return { data, evidence: [request.reportPath] };
  },
};
