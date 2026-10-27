/**
 * Turns an assembly plan into a delivery file. Intermediate files (the audio
 * mix, ffmpeg logs) live in `<output dir>/.assemble-<basename>/`, which is
 * removed on success and left behind on failure so the logs can be read. On
 * failure the half-written delivery and the sidecar this run copied are
 * removed too, so a later QA step cannot pick them up. Every ffmpeg command
 * is logged at debug level before it runs, quoted so the line can be pasted
 * into a shell.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { Logger } from '../cli/logger.ts';
import { removeDirectoryWithRetry } from '../fs/paths.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { stderrTail } from '../process/process-runner.ts';
import { totalFrames } from '../schema/checks/assembly-plan.ts';
import type { AssemblyPlan, AudioMix, Codec } from '../shared/contracts/assembly-plan.ts';
import { frameToSeconds } from '../shared/frame-time.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';
import { LoudnessMeasurementError } from './assemble-error.ts';
import { hasAudio, parseLoudnormJson, parseOutputIntegrated } from './audio.ts';
import type { LoudnessMeasurement } from './audio.ts';
import { copySidecar } from './captions.ts';
import type { SidecarCopy } from './captions.ts';
import { encodeInvocation, measureArguments, mixArguments } from './invocation.ts';
import type { MeasuredMix } from './invocation.ts';
import { probeVideo } from './probe.ts';
import type { ProbedVideo } from './probe.ts';

/** Integrated loudness in LUFS: before normalization and, when loudnorm's pass-two summary reported it, after. */
export interface DeliveryLoudness {
  readonly inputI: number;
  /** What loudnorm measured on the normalized audio; absent when its summary printed no "Output Integrated" line. Never the target. */
  readonly outputI?: number;
}

/** What assembling produced. */
export interface AssembleResult {
  readonly outputPath: string;
  /** The delivery length in frames, from the plan (clips minus transition overlaps). */
  readonly durationFrames: number;
  readonly durationSeconds: number;
  readonly codec: Codec;
  /** The SRT written next to the delivery, when the plan has captions. */
  readonly sidecarPath?: string;
  /** Loudness before and after normalization, when the plan has audio. */
  readonly loudness?: DeliveryLoudness;
}

/** The directory a delivery's intermediate files are written to. */
export function jobTempDir(outputPath: string): string {
  return join(dirname(outputPath), `.assemble-${basename(outputPath, extname(outputPath))}`);
}

/** An argument as the debug log prints it: wrapped in double quotes (inner quotes escaped) when it holds whitespace or a shell character, so the logged command can be pasted into a shell. The spawned argv is never quoted. */
export function quoteForLog(argument: string): string {
  return /[\s;[\]|&<>"]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument;
}

/** Runs the ffmpeg passes an assembly plan needs. */
export class Assembler {
  private readonly runner: ProcessRunner;
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly log: Logger;

  constructor(runner: ProcessRunner, ffmpegPath: string, ffprobePath: string, log: Logger) {
    this.runner = runner;
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.log = log;
  }

  /** Assembles the plan into its output file. The plan has passed the schema and checkAssemblyPlan. When a pass fails, the delivery and a sidecar this run copied are removed and the temp directory with the logs stays. */
  async assemble(plan: AssemblyPlan, signal: AbortSignal): Promise<AssembleResult> {
    const outputPath = plan.output.path;
    const tempDir = jobTempDir(outputPath);
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    const sidecar = plan.captions === undefined ? undefined : copySidecar(plan.captions, outputPath);
    try {
      return await this.runPasses(plan, tempDir, sidecar, signal);
    } catch (error: unknown) {
      rmSync(outputPath, { force: true });
      if (sidecar?.copied === true) rmSync(sidecar.path, { force: true });
      throw error;
    }
  }

  /** Reads the delivery back with ffprobe; `durationFrames` (from the plan) sizes the time budget for counting its frames. */
  probeOutput(outputPath: string, durationFrames: number, signal: AbortSignal): Promise<ProbedVideo> {
    return probeVideo(this.runner, this.ffprobePath, outputPath, durationFrames, signal);
  }

  private async runPasses(plan: AssemblyPlan, tempDir: string, sidecar: SidecarCopy | undefined, signal: AbortSignal): Promise<AssembleResult> {
    const frames = totalFrames(plan);
    const outputPath = plan.output.path;
    let mix: MeasuredMix | undefined;
    if (hasAudio(plan)) {
      const mixPath = join(tempDir, 'mix.wav');
      this.log.info(`assemble: mixing ${plan.audio.narration.length} narration line(s)${plan.audio.music === null ? '' : ' and music'}`);
      await this.ffmpeg(mixArguments(plan.audio, frames, plan.fps, mixPath), 'ffmpeg (audio mix)', join(tempDir, 'mix.log'), signal);
      const measured = await this.measure(plan.audio, mixPath, join(tempDir, 'loudnorm.log'), signal);
      mix = { audio: plan.audio, mixPath, measured };
    }

    this.log.info(`assemble: encoding ${frames} frames (${plan.output.codec}) to ${outputPath}`);
    const encodeLog = join(tempDir, 'encode.log');
    const encode = await this.ffmpeg(encodeInvocation(plan, mix), 'ffmpeg (encode)', encodeLog, signal);
    const loudness = mix === undefined ? undefined : this.loudnessOf(mix.measured, encode.stderr, encodeLog);

    const keepLogs = loudness !== undefined && loudness.outputI === undefined;
    if (!keepLogs) await this.removeTempDir(tempDir);
    return {
      outputPath,
      durationFrames: frames,
      durationSeconds: frameToSeconds(frames, plan.fps),
      codec: plan.output.codec,
      ...(sidecar === undefined ? {} : { sidecarPath: sidecar.path }),
      ...(loudness === undefined ? {} : { loudness }),
    };
  }

  /** Pass one's input_i with pass two's "Output Integrated"; the latter is omitted, with a warning naming the kept encode log, when the summary did not print it. */
  private loudnessOf(measured: LoudnessMeasurement, encodeStderr: string, encodeLog: string): DeliveryLoudness {
    const inputI = Number.parseFloat(measured.inputI);
    const outputI = parseOutputIntegrated(encodeStderr);
    if (outputI === undefined) {
      this.log.warn(`loudnorm printed no Output Integrated line; see ${encodeLog}`);
      return { inputI };
    }
    return { inputI, outputI };
  }

  private async removeTempDir(tempDir: string): Promise<void> {
    try {
      await removeDirectoryWithRetry(tempDir);
    } catch (error: unknown) {
      this.log.warn(`could not remove ${tempDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async measure(audio: AudioMix, mixPath: string, logPath: string, signal: AbortSignal): Promise<LoudnessMeasurement> {
    const result = await this.ffmpeg(measureArguments(audio, mixPath), 'ffmpeg (loudness analysis)', logPath, signal);
    const measured = parseLoudnormJson(result.stderr);
    if (measured === undefined) throw new LoudnessMeasurementError(mixPath, stderrTail(result.stderr));
    this.log.debug(`loudnorm measured input_i=${measured.inputI} input_tp=${measured.inputTp} input_lra=${measured.inputLra}`);
    return measured;
  }

  private ffmpeg(args: readonly string[], label: string, logPath: string, signal: AbortSignal): ReturnType<typeof runFfmpeg> {
    this.log.debug([this.ffmpegPath, '-hide_banner', ...args].map(quoteForLog).join(' '));
    return runFfmpeg(this.runner, this.ffmpegPath, args, { label, stderrFile: logPath, failureHint: 'Check the clip sources and audio files named in the plan, then run assemble again with --verbose.' }, signal);
  }
}
