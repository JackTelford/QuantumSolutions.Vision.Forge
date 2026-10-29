/**
 * `plan --brief <file> --treatment <file> --shot-spec <file> --look <file>`:
 * turns the four approved documents into a job folder.
 *
 * Every document is read, checked against its schema and its semantic rules
 * (all problems of all four reported at once), then the four are checked
 * against each other (ids, frame, beats, transition grammar, length). Each
 * shot gets its key (ADR 0006 decision 8) and the job gets its id, the
 * first eight characters of the content hash of the four documents, so the
 * same documents always plan into `<out>/<jobId>/`. The folder holds copies
 * of the documents and job.json; a rerun keeps the state of every shot whose
 * key is unchanged. Paths resolve against the working directory.
 */
import { resolve } from 'node:path';
import { crossDocumentProblems, crossDocumentWarnings, shotStartFrames } from '../../plan/cross-checks.ts';
import type { PlanDocuments } from '../../plan/cross-checks.ts';
import { documentOptions, loadPlanDocuments } from '../../plan/documents.ts';
import type { DocumentPaths } from '../../plan/documents.ts';
import { buildJob, jobFolder, jobId, keptShotCount, readPreviousJob, writeJobFolder } from '../../plan/job.ts';
import { CrossDocumentError } from '../../plan/plan-error.ts';
import { renderFingerprint, shotKey } from '../../plan/shot-key.ts';
import { compositionProblems, compositionWarnings } from '../../shared/composition/checks.ts';
import { baseFrame } from '../../shared/composition/framing.ts';
import { solveBasePose } from '../../shared/composition/solver.ts';
import { totalFrames } from '../../schema/checks/shot-spec.ts';
import type { JobStatus } from '../../shared/contracts/job.ts';
import type { Lane, Shot, ShotSpec } from '../../shared/contracts/shot-spec.ts';
import { frameToSeconds } from '../../shared/frame-time.ts';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';

/** One shot of the plan payload. */
export interface PlanShotData {
  readonly id: string;
  readonly lane: Lane;
  /** The shot key: 64 lowercase hex characters (ADR 0006 decision 8). */
  readonly key: string;
  readonly durationFrames: number;
  /** The delivery frame the shot starts at, counted from 0, after the transition overlaps before it. */
  readonly startFrame: number;
}

/** Shape of the plan payload. */
export interface PlanData {
  readonly jobId: string;
  /** Absolute path of the job folder, <out>/<jobId>. */
  readonly jobDir: string;
  /** Absolute path of job.json inside the folder. */
  readonly jobPath: string;
  readonly status: JobStatus;
  readonly shots: readonly PlanShotData[];
  /** The delivery length in frames: the shots minus every non-cut transition overlap. */
  readonly totalFrames: number;
  /** The delivery length in seconds at the spec's fps. */
  readonly durationSeconds: number;
  /** The length the brief asked for, in seconds. */
  readonly briefDurationSeconds: number;
  /** The cross-document warnings that were logged, in order; empty when none. */
  readonly warnings: readonly string[];
}

/** One line per shot for the log: id, lane, size, lens, move and length, for example `s01  html  MS  85mm f/4  push-in  120 f`. */
export function describeShot(shot: Shot): string {
  return `${shot.id}  ${shot.lane}  ${shot.size}  ${shot.lens.focalMm}mm f/${shot.lens.fStop}  ${shot.move.preset}  ${shot.durationFrames} f`;
}

/** The totals line for the log, for example `5 shots, 600 frames, 20.0 s; brief asks 20 s`. */
export function describeTotals(documents: PlanDocuments): string {
  const { shotSpec, brief } = documents;
  const frames = totalFrames(shotSpec);
  return `${shotSpec.shots.length} shots, ${frames} frames, ${frameToSeconds(frames, shotSpec.fps).toFixed(1)} s; brief asks ${brief.durationSeconds} s`;
}

/** The four document paths from the arguments, each required and resolved against the working directory. */
export function documentPathsFromArguments(context: CommandContext, args: ParsedArguments): DocumentPaths {
  const resolved = documentOptions.map((entry) => [entry.option, resolve(context.cwd, args.requireString(entry.option, `the approved ${entry.kind} document`))] as const);
  return Object.fromEntries(resolved) as DocumentPaths;
}

/**
 * The composition solver's geometric checks (subject inside action safe, anchor
 * on the grid, text inside title safe and off the subject, headroom, text
 * size) on every shot's base framing, each sentence prefixed with the shot id.
 * The contrast and luma checks need a rendered frame and belong to qa.
 */
export function compositionProblemsOf(shotSpec: ShotSpec): readonly string[] {
  const spec = { fps: shotSpec.fps, width: shotSpec.width, height: shotSpec.height };
  return shotSpec.shots.flatMap((shot) => compositionProblems(shot, spec, baseFrame(shot, solveBasePose(shot, spec))).map((problem) => `shot "${shot.id}": ${problem}`));
}

/** The composition warnings (competing text boxes) of every shot, prefixed with the shot id. */
export function compositionWarningsOf(shotSpec: ShotSpec): readonly string[] {
  return shotSpec.shots.flatMap((shot) => compositionWarnings(shot).map((warning) => `shot "${shot.id}": ${warning}`));
}

/** The plan command. */
export const command: Command = {
  name: 'plan',
  summary: 'Check the brief, treatment, shot spec and look bible against each other and write the job folder with a key per shot.',
  options: { strings: documentOptions.map((entry) => entry.option), flags: [] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const paths = documentPathsFromArguments(context, args);
    const documents = loadPlanDocuments(paths, context.dataDir);
    const { brief, treatment, shotSpec, look } = documents;
    const problems = [...crossDocumentProblems(brief, treatment, shotSpec, look), ...compositionProblemsOf(shotSpec)];
    if (problems.length > 0) throw new CrossDocumentError(problems);
    const warnings = [...crossDocumentWarnings(brief, treatment, shotSpec, look), ...compositionWarningsOf(shotSpec)];
    for (const shot of shotSpec.shots) context.log.info(describeShot(shot));
    context.log.info(describeTotals(documents));
    for (const warning of warnings) context.log.warn(warning);

    const fingerprint = renderFingerprint(context.dataDir);
    const keys = await Promise.all(shotSpec.shots.map((shot) => shotKey(shot, look, fingerprint)));
    const id = await jobId(brief, treatment, shotSpec, look);
    const folder = jobFolder(context.outDir, id);
    const previous = readPreviousJob(folder);
    const job = buildJob({ id, documents, keys, folder, dataDir: context.dataDir, createdAt: context.now().toISOString(), previous });
    if (previous !== undefined) context.log.info(`${folder.jobPath} exists; ${keptShotCount(previous, job)} of ${job.shots.length} shots keep their status`);
    writeJobFolder(folder, documents, job);
    context.log.info(`wrote ${folder.jobPath}`);

    const starts = shotStartFrames(shotSpec);
    const frames = totalFrames(shotSpec);
    const data: PlanData = {
      jobId: id,
      jobDir: folder.dir,
      jobPath: folder.jobPath,
      status: job.status,
      shots: shotSpec.shots.map((shot, index) => ({ id: shot.id, lane: shot.lane, key: keys[index] ?? '', durationFrames: shot.durationFrames, startFrame: starts[index] ?? 0 })),
      totalFrames: frames,
      durationSeconds: frameToSeconds(frames, shotSpec.fps),
      briefDurationSeconds: brief.durationSeconds,
      warnings,
    };
    return { data, artifacts: [], evidence: [folder.jobPath] };
  },
};
