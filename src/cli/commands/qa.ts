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
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { DataFileError, UsageError } from '../../errors/vision-forge-error.ts';
import { checkAudio, defaultLoudnessTarget, defaultTruePeakCeiling } from '../../qa/audio-checks.ts';
import type { Analysis } from '../../qa/check.ts';
import { checkDimensions, checkDuration, checkFps, expectationsFromPlan } from '../../qa/expectation-checks.ts';
import { checkExposureDrift } from '../../qa/exposure.ts';
import { checkBlackFrames, checkFrozenFrames, checkPops } from '../../qa/motion-checks.ts';
import { planContext } from '../../qa/plan-context.ts';
import type { PlanContext } from '../../qa/plan-context.ts';
import { probeVideo } from '../../qa/probe.ts';
import { QaFailedError } from '../../qa/qa-failed-error.ts';
import { buildQaReport, failedCheckIds, writeQaReport } from '../../qa/report.ts';
import { checkHeroStillMatch } from '../../qa/still-match.ts';
import { checkTextContrast, readTextBoxes } from '../../qa/text-contrast.ts';
import type { TextBox } from '../../qa/text-contrast.ts';
import type { Check, CheckId } from '../../shared/contracts/qa-report.ts';
import { requireFfmpeg, requireFfprobe } from '../../tools/ffmpeg.ts';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';
import { loadAssemblyPlan } from './assemble.ts';

/** Shape of the qa payload. */
export interface QaData {
  /** Absolute path of the report that was written. */
  readonly reportPath: string;
  readonly passed: boolean;
  /** Ids of the checks that failed, each once, in report order. */
  readonly failed: readonly CheckId[];
}

/** Everything the command resolved from its arguments. */
export interface QaRequest {
  readonly videoPath: string;
  readonly plan: PlanContext | undefined;
  readonly textBoxes: readonly TextBox[] | undefined;
  readonly still: { readonly path: string; readonly frame: number } | undefined;
  readonly reportPath: string;
  readonly loudnessTarget: number;
  readonly truePeakCeiling: number;
  readonly noFail: boolean;
}

/** Where the report goes when --report is absent: <out>/qa/<video name>.qa.json. */
export function defaultReportPath(outDir: string, videoPath: string): string {
  return join(outDir, 'qa', `${basename(videoPath, extname(videoPath))}.qa.json`);
}

function requireExisting(path: string, what: string): string {
  if (!existsSync(path)) throw new DataFileError(path, 'the file does not exist', `Pass the path of ${what}, absolute or relative to the working directory.`);
  return path;
}

/** Resolves the arguments into a request; usage errors name the option. */
export function parseRequest(context: CommandContext, args: ParsedArguments): QaRequest {
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
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  return checks;
}

/** The qa command. */
export const command: Command = {
  name: 'qa',
  summary: 'Measure a delivery (black and frozen frames, pops, exposure, text contrast, loudness, hero still) and write a QA report.',
  options: { strings: ['video', 'plan', 'text-boxes', 'still', 'still-frame', 'report', 'loudness-target'], flags: ['no-fail'] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const request = parseRequest(context, args);
    const ffmpegPath = requireFfmpeg();
    const ffprobePath = requireFfprobe();
    const checks = await runChecks(context, request, ffmpegPath, ffprobePath);
    const report = buildQaReport({ kind: 'deliverable', path: request.videoPath, shotId: null }, checks, [], context.now());
    writeQaReport(request.reportPath, report);
    const failed = failedCheckIds(checks);
    context.log.info(`qa: ${report.passed ? 'passed' : `failed ${failed.join(', ')}`}; report at ${request.reportPath}`);
    if (!report.passed && !request.noFail) throw new QaFailedError(failed, request.reportPath);
    const data: QaData = { reportPath: request.reportPath, passed: report.passed, failed };
    return { data, evidence: [request.reportPath] };
  },
};
