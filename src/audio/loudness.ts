/**
 * Two-pass loudness normalization of one narration file (ADR 0007): the
 * same `loudnorm` shape the assembler runs on a mix (`src/assemble/audio.ts`),
 * measured first, then applied in linear mode with the measured values, to
 * -16 LUFS integrated and -1.5 dBTP true peak. The output keeps 24 kHz mono
 * (loudnorm resamples to 192 kHz inside, so the rate is pinned on the way
 * out) as 16-bit PCM, which the assembler mixes without conversion.
 */
import { loudnessRangeTarget, parseLoudnormJson } from '../assemble/audio.ts';
import type { LoudnessMeasurement } from '../assemble/audio.ts';
import { DataFileError } from '../errors/vision-forge-error.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';
import { narrationSampleRate } from './wav.ts';

/** The integrated loudness a narration is normalized to, in LUFS. */
export const narrationLoudnessTarget = -16;

/** The true-peak ceiling of a narration, in dBTP. */
export const narrationTruePeakCeiling = -1.5;

/** What normalizing one file needs. */
export interface NormalizeLoudnessOptions {
  readonly runner: ProcessRunner;
  readonly ffmpegPath: string;
  /** The raw concatenated narration. */
  readonly input: string;
  /** The normalized file; overwritten. */
  readonly output: string;
  readonly signal: AbortSignal;
}

/** The loudnorm analysis filter (pass one): targets only, statistics printed as JSON on standard error. */
export function narrationLoudnormMeasureFilter(): string {
  return `loudnorm=I=${narrationLoudnessTarget}:TP=${narrationTruePeakCeiling}:LRA=${loudnessRangeTarget}:print_format=json`;
}

/** The loudnorm filter for pass two: the measured values, linear normalization, a summary printed on standard error. */
export function narrationLoudnormApplyFilter(measured: LoudnessMeasurement): string {
  return `loudnorm=I=${narrationLoudnessTarget}:TP=${narrationTruePeakCeiling}:LRA=${loudnessRangeTarget}:measured_I=${measured.inputI}:measured_TP=${measured.inputTp}:measured_LRA=${measured.inputLra}:measured_thresh=${measured.inputThresh}:offset=${measured.targetOffset}:linear=true:print_format=summary`;
}

/** The ffmpeg arguments of pass one: analyse the input, discard the audio. */
export function loudnessMeasureArguments(input: string): readonly string[] {
  return ['-nostats', '-i', input, '-af', narrationLoudnormMeasureFilter(), '-f', 'null', '-'];
}

/** The ffmpeg arguments of pass two: apply the measured values and write 24 kHz mono 16-bit PCM. */
export function loudnessApplyArguments(input: string, output: string, measured: LoudnessMeasurement): readonly string[] {
  return ['-nostats', '-y', '-i', input, '-af', narrationLoudnormApplyFilter(measured), '-ar', String(narrationSampleRate), '-ac', '1', '-c:a', 'pcm_s16le', output];
}

/** Runs both passes and returns what pass one measured (the raw file's loudness, for the log). */
export async function normalizeNarrationLoudness(options: NormalizeLoudnessOptions): Promise<LoudnessMeasurement> {
  const hint = 'Check that the raw narration WAV decodes; run the command again with --verbose to see the full ffmpeg output.';
  const analysis = await runFfmpeg(options.runner, options.ffmpegPath, loudnessMeasureArguments(options.input), { label: 'ffmpeg loudnorm (measure)', failureHint: hint }, options.signal);
  const measured = parseLoudnormJson(analysis.stderr);
  if (measured === undefined) throw new DataFileError(options.input, 'loudnorm printed no measurement', hint);
  await runFfmpeg(options.runner, options.ffmpegPath, loudnessApplyArguments(options.input, options.output, measured), { label: 'ffmpeg loudnorm (apply)', failureHint: hint }, options.signal);
  return measured;
}
