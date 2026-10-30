/**
 * `assemble`: turns an assembly plan into a delivery file with ffmpeg, then
 * reads the file back with ffprobe and checks it against the plan.
 *
 * `--plan <file>` names a plan written by hand. `--job <folder or job.json>
 * [--music <file>] [--music-gain <dB>] [--burn-in] [--codec h264|hevc|prores]
 * [--out-file <path>]` builds the plan from the job instead: the rendered
 * shots' caches, the shot spec's transitions, the narration `audio synth
 * --out <job>` wrote under `<job>/narration/` with its captions, the look's
 * grade, and `<job>/<jobId>.mp4` (`.mov` for ProRes) as the delivery. The
 * plan is written to `<job>/assembly-plan.json` as evidence, the job moves
 * to `assembling` and then to `qa` with its delivery recorded.
 *
 * Either way the plan is validated against its schema and the semantic
 * checks before any program runs. The result carries the delivery path, its
 * length, the codec, what ffprobe verified and, with audio, the loudness
 * before and after normalization.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AssembleVerificationError } from '../../assemble/assemble-error.ts';
import { Assembler } from '../../assemble/assembler.ts';
import type { DeliveryLoudness } from '../../assemble/assembler.ts';
import { buildAssemblyPlan, defaultMusicGainDb, deliveryExtension } from '../../assemble/plan-from-job.ts';
import type { MusicInput, NarrationFiles } from '../../assemble/plan-from-job.ts';
import type { ProbedVideo } from '../../assemble/probe.ts';
import { narrationFileNames } from '../../audio/synth.ts';
import { DataFileError, SchemaValidationError, UsageError } from '../../errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../../fs/atomic-json.ts';
import { loadJob, saveJob, withDelivery, withStatus } from '../../render/job-state.ts';
import { readManifest } from '../../render/manifest.ts';
import { totalFrames } from '../../schema/checks/assembly-plan.ts';
import { runSemanticChecks } from '../../schema/checks/index.ts';
import { isJsonObject } from '../../schema/schema-registry.ts';
import { validateDocument } from '../../schema/validator.ts';
import { CodecValues } from '../../shared/contracts/assembly-plan.ts';
import type { AssemblyPlan, Codec } from '../../shared/contracts/assembly-plan.ts';
import { generateCube } from '../../shared/grade/grade.ts';
import { requireFfmpeg, requireFfprobe } from '../../tools/ffmpeg.ts';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';

/** Shape of the assemble payload. */
export interface AssembleData {
  readonly outputPath: string;
  readonly durationFrames: number;
  readonly durationSeconds: number;
  readonly codec: Codec;
  /** What ffprobe read back from the delivery. */
  readonly verified: {
    readonly frames: number;
    readonly fps: number;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: string;
  };
  /** Integrated loudness in LUFS before normalization and, when loudnorm reported it, after; absent for a silent delivery. */
  readonly loudness?: DeliveryLoudness;
}

/** The files `assemble --job` writes into the job folder beside the delivery. */
export const jobAssemblyFileNames = {
  plan: 'assembly-plan.json',
  cube: 'grade.cube',
} as const;

/** Reads a plan file, validates it against the schema and runs the semantic checks; throws SchemaValidationError on any problem. */
export function loadAssemblyPlan(path: string): AssemblyPlan {
  const document = readJsonFile(path);
  validateDocument('assembly-plan', document);
  const plan = document as AssemblyPlan;
  const problems = runSemanticChecks('assembly-plan', document, { dataDir: undefined });
  if (problems.length > 0) throw new SchemaValidationError('assembly-plan', problems, `Fix the plan at ${path}; the rules are in src/schema/checks/assembly-plan.ts.`);
  return plan;
}

/** Problems between what the plan asked for and what ffprobe read back: another frame count (exact: a source one frame short would shift every later transition), another rate, another size, or pixels that are not square. */
export function verifyDelivery(plan: AssemblyPlan, probed: ProbedVideo): readonly string[] {
  const problems: string[] = [];
  const expected = totalFrames(plan);
  if (probed.frames !== expected) problems.push(`expected ${expected} frames, found ${probed.frames}`);
  if (!(Math.abs(probed.fps - plan.fps) < 1e-6)) problems.push(`expected ${plan.fps} fps, found ${probed.fps}`);
  if (probed.width !== plan.width || probed.height !== plan.height) problems.push(`expected ${plan.width}x${plan.height}, found ${probed.width}x${probed.height}`);
  if (probed.sampleAspectRatio !== '1:1') problems.push(`expected square pixels (SAR 1:1), found SAR ${probed.sampleAspectRatio}`);
  return problems;
}

/** Where `audio synth --out <job>` leaves the narration document: `<job>/narration/narration.json`. */
export function narrationDocumentPath(jobDir: string): string {
  return join(jobDir, 'narration', narrationFileNames.json);
}

/** The narration files named by a narration.json; a file that is not one (or names no WAV and SRT) is a data-file error. The document has no schema: M6 writes it from a typed record. */
export function readNarrationFiles(path: string): NarrationFiles {
  const document: unknown = readJsonFile(path);
  const fields = isJsonObject(document) ? document : undefined;
  const wavPath = fields?.['wavPath'];
  const srtPath = fields?.['srtPath'];
  if (fields?.['kind'] !== 'narration' || typeof wavPath !== 'string' || typeof srtPath !== 'string') {
    throw new DataFileError(path, 'it is not a narration document with a wavPath and an srtPath', 'Run audio synth --out <job folder> again; it writes narration/narration.json beside narration.wav and captions.srt.');
  }
  // Nothing in src/assemble checks that an input exists; a missing WAV would surface as an ffmpeg error after the plan is written and the job moved.
  for (const [what, file] of [['wavPath', wavPath], ['srtPath', srtPath]] as const) {
    if (!existsSync(file)) throw new DataFileError(path, `its ${what} ${file} does not exist`, 'Run audio synth --out <job folder> again; it writes narration.wav and captions.srt beside narration.json.');
  }
  return { wavPath, srtPath };
}

/** The codec option, h264 when absent; a usage error names the three codecs otherwise. */
export function parseCodec(value: string | undefined): Codec {
  if (value === undefined) return 'h264';
  const codec = CodecValues.find((candidate) => candidate === value);
  if (codec === undefined) throw new UsageError(`--codec must be one of ${CodecValues.join(', ')}, got "${value}".`, 'Pass --codec h264 (the default), hevc or prores.');
  return codec;
}

/** The music option with its gain: --music-gain without --music is a mistake worth naming; the file must exist. */
export function parseMusic(args: ParsedArguments, cwd: string): MusicInput | null {
  const music = args.string('music');
  const gainDb = args.number('music-gain');
  if (music === undefined) {
    if (gainDb !== undefined) throw new UsageError('--music-gain needs --music.', 'Pass --music <file> with the music track the gain applies to.');
    return null;
  }
  const path = resolve(cwd, music);
  if (!existsSync(path)) throw new DataFileError(path, 'the file does not exist', 'Pass --music with the path of a WAV, FLAC, MP3 or AAC file, absolute or relative to the working directory.');
  return { path, gainDb: gainDb ?? defaultMusicGainDb };
}

/** What assembling one plan produced, as the payload and the artifact list. */
interface Assembled {
  readonly data: AssembleData;
  readonly artifacts: readonly string[];
}

/** Runs the assembler over a validated plan, probes the delivery back and holds it to the plan. */
async function assemblePlan(context: CommandContext, plan: AssemblyPlan): Promise<Assembled> {
  const ffmpegPath = requireFfmpeg();
  const ffprobePath = requireFfprobe();
  const assembler = new Assembler(context.runner, ffmpegPath, ffprobePath, context.log);
  const result = await assembler.assemble(plan, context.signal);
  const probed = await assembler.probeOutput(result.outputPath, result.durationFrames, context.signal);
  const problems = verifyDelivery(plan, probed);
  if (problems.length > 0) throw new AssembleVerificationError(result.outputPath, problems);
  context.log.info(`assemble: wrote ${result.outputPath} (${probed.frames} frames, ${probed.width}x${probed.height} at ${probed.fps} fps)`);
  const data: AssembleData = {
    outputPath: result.outputPath,
    durationFrames: result.durationFrames,
    durationSeconds: result.durationSeconds,
    codec: result.codec,
    verified: { frames: probed.frames, fps: probed.fps, width: probed.width, height: probed.height, colorSpace: probed.colorSpace },
    ...(result.loudness === undefined ? {} : { loudness: result.loudness }),
  };
  return { data, artifacts: [result.outputPath, ...(result.sidecarPath === undefined ? [] : [result.sidecarPath])] };
}

/** The --job path: the plan from the job folder, written as evidence, then the delivery and the job's move to qa. */
async function assembleJob(context: CommandContext, args: ParsedArguments, jobArg: string): Promise<CommandOutput> {
  const loaded = loadJob(resolve(context.cwd, jobArg));
  const { folder, job, look } = loaded;
  const codec = parseCodec(args.string('codec'));
  const music = parseMusic(args, context.cwd);
  const outFile = args.string('out-file');
  const outputPath = outFile === undefined ? join(folder.dir, `${job.id}${deliveryExtension(codec)}`) : resolve(context.cwd, outFile);
  const narrationPath = narrationDocumentPath(folder.dir);
  const narration = existsSync(narrationPath) ? readNarrationFiles(narrationPath) : null;
  context.log.info(`assemble: job ${job.id}, ${narration === null ? 'no narration' : 'narration from ' + narrationPath}, ${music === null ? 'no music' : 'music from ' + music.path}`);
  const cubePath = join(folder.dir, jobAssemblyFileNames.cube);
  const plan = buildAssemblyPlan({ job, shotSpec: loaded.shotSpec, look, narration, music, burnIn: args.flag('burn-in'), cubePath, outputPath, codec, readManifest });
  // Written only once the plan is known to build, so a refused job leaves nothing behind: the same grade the stills were judged with, baked once for the whole delivery.
  writeFileSync(cubePath, generateCube(look.grade), 'utf8');
  const planPath = join(folder.dir, jobAssemblyFileNames.plan);
  writeJsonAtomic(planPath, plan);
  // A previous run's delivery is forgotten here: an assemble that does not finish must not leave the old file recorded beside the new plan for qa to measure.
  saveJob(folder, { ...withStatus(job, 'assembling'), deliverablePath: null });
  const assembled = await assemblePlan(context, plan);
  saveJob(folder, withDelivery(job, assembled.data.outputPath));
  return { data: assembled.data, artifacts: assembled.artifacts, evidence: [planPath] };
}

/** The assemble command. */
export const command: Command = {
  name: 'assemble',
  summary: 'Turn an assembly plan, or the plan built from a job, into a delivery file with ffmpeg and verify it with ffprobe.',
  options: { strings: ['plan', 'job', 'music', 'music-gain', 'codec', 'out-file'], flags: ['burn-in'] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const planArg = args.string('plan');
    const jobArg = args.string('job');
    if (planArg !== undefined && jobArg !== undefined) throw new UsageError('Pass --plan or --job, not both.', 'Use --job <folder> to build the plan from the job, or --plan <file> for a plan written by hand.');
    if (jobArg !== undefined) return assembleJob(context, args, jobArg);
    if (planArg === undefined) throw new UsageError('Missing --plan or --job.', 'Pass --job <folder or job.json> (the plan command wrote it) or --plan <file>: the assembly plan JSON to turn into a delivery.');
    if ((args.string('music') ?? args.string('music-gain') ?? args.string('codec') ?? args.string('out-file')) !== undefined || args.flag('burn-in')) {
      throw new UsageError('--music, --music-gain, --burn-in, --codec and --out-file go with --job.', 'A hand-written plan names its own audio, captions and output; edit the plan file instead.');
    }
    const plan = loadAssemblyPlan(resolve(context.cwd, planArg));
    const assembled = await assemblePlan(context, plan);
    return { data: assembled.data, artifacts: assembled.artifacts };
  },
};
