/**
 * `assemble`: turns an assembly plan into a delivery file with ffmpeg, then
 * reads the file back with ffprobe and checks it against the plan.
 *
 * `--plan <file>` names the plan. The plan is validated against its schema
 * and the semantic checks before any program runs. The result carries the
 * delivery path, its length, the codec, what ffprobe verified and, with
 * audio, the loudness before and after normalization.
 */
import { resolve } from 'node:path';
import { AssembleVerificationError } from '../../assemble/assemble-error.ts';
import { Assembler } from '../../assemble/assembler.ts';
import type { DeliveryLoudness } from '../../assemble/assembler.ts';
import type { ProbedVideo } from '../../assemble/probe.ts';
import { SchemaValidationError } from '../../errors/vision-forge-error.ts';
import { readJsonFile } from '../../fs/atomic-json.ts';
import { totalFrames } from '../../schema/checks/assembly-plan.ts';
import { runSemanticChecks } from '../../schema/checks/index.ts';
import { validateDocument } from '../../schema/validator.ts';
import type { AssemblyPlan, Codec } from '../../shared/contracts/assembly-plan.ts';
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

/** The assemble command. */
export const command: Command = {
  name: 'assemble',
  summary: 'Turn an assembly plan into a delivery file with ffmpeg and verify it with ffprobe.',
  options: { strings: ['plan'], flags: [] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const planPath = resolve(context.cwd, args.requireString('plan', 'the assembly plan JSON to turn into a delivery'));
    const plan = loadAssemblyPlan(planPath);
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
  },
};
