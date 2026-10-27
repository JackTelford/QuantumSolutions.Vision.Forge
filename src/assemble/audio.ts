/**
 * The audio of a delivery: narration lines placed on the timeline, music
 * under them with optional ducking, and two-pass loudness normalization.
 *
 * The mix is rendered once to a WAV in the job's temp directory, measured
 * with `loudnorm` in its analysis mode, then normalized with the measured
 * values (linear mode) while the delivery is encoded. Every input is first
 * brought to 48 kHz stereo float so a 24 kHz mono narration and a stereo
 * music file mix cleanly. Pure: this file builds filter graphs and parses
 * ffmpeg output; the assembler runs ffmpeg.
 */
import type { AssemblyPlan, AudioMix } from '../shared/contracts/assembly-plan.ts';
import { frameToMilliseconds } from '../shared/frame-time.ts';
import { secondsText } from './graph.ts';

/** The label of the rendered mix inside the mix graph. */
export const mixLabel = '[amix]';

/** The label of the normalized audio inside the final encode graph. */
export const normalizedLabel = '[aout]';

/** Brings any input to the mix format. */
export const mixFormat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

/** The ducking compressor keyed by the narration mix. */
export const duckingFilter = 'sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400';

/** Loudness range target passed to loudnorm in both passes. */
export const loudnessRangeTarget = 11;

/** What loudnorm's analysis pass measured, as the strings it printed. */
export interface LoudnessMeasurement {
  readonly inputI: string;
  readonly inputTp: string;
  readonly inputLra: string;
  readonly inputThresh: string;
  readonly targetOffset: string;
}

/** True when the plan has an audio section with at least one narration line or a music track. */
export function hasAudio(plan: AssemblyPlan): plan is AssemblyPlan & { readonly audio: AudioMix } {
  return plan.audio !== undefined && (plan.audio.narration.length > 0 || plan.audio.music !== null);
}

/** The `-i` arguments of every audio file: narration lines in order, then the music; input `k` is narration line `k`. */
export function audioInputArguments(audio: AudioMix): readonly string[] {
  const inputs = audio.narration.flatMap((line) => ['-i', line.path]);
  return audio.music === null ? inputs : [...inputs, '-i', audio.music.path];
}

/**
 * The mix graph for a delivery of `totalFrames` frames: each narration
 * line delayed to its start frame (`adelay=<ms>|<ms>`, both channels) and
 * summed with `amix=inputs=<n>:normalize=0` into `[nar]`; the music with
 * `volume=<gainDb>dB` into `[mus]`; with ducking, the music is compressed
 * by the narration key (padded to the delivery length so the compressor
 * does not end early); the result is padded and trimmed to the delivery
 * length as `[amix]`.
 */
export function mixGraph(audio: AudioMix, totalFrames: number, fps: number): string {
  const length = secondsText(totalFrames, fps);
  const filters: string[] = [];
  const lines = audio.narration;
  const hasNarration = lines.length > 0;
  if (hasNarration) {
    lines.forEach((line, index) => {
      const ms = Math.round(frameToMilliseconds(line.startFrame, fps));
      filters.push(`[${index}:a]${mixFormat},adelay=${ms}|${ms}[n${index}]`);
    });
    filters.push(`${lines.map((_line, index) => `[n${index}]`).join('')}amix=inputs=${lines.length}:normalize=0[nar]`);
  }
  let mixed: string;
  if (audio.music !== null) {
    filters.push(`[${lines.length}:a]${mixFormat},volume=${audio.music.gainDb}dB[mus]`);
    if (hasNarration && audio.music.duckUnderNarration) {
      filters.push('[nar]asplit=2[nar0][nar1]', `[nar1]apad=whole_dur=${length}[key]`, `[mus][key]${duckingFilter}[duck]`, '[nar0][duck]amix=inputs=2:normalize=0[mixed]');
      mixed = '[mixed]';
    } else if (hasNarration) {
      filters.push('[nar][mus]amix=inputs=2:normalize=0[mixed]');
      mixed = '[mixed]';
    } else {
      mixed = '[mus]';
    }
  } else {
    mixed = '[nar]';
  }
  filters.push(`${mixed}apad=whole_dur=${length},atrim=end=${length},asetpts=PTS-STARTPTS${mixLabel}`);
  return filters.join(';');
}

/** The loudnorm analysis filter (pass one): targets only, statistics printed as JSON on standard error. */
export function loudnormMeasureFilter(audio: AudioMix): string {
  return `loudnorm=I=${audio.loudnessLufs}:TP=${audio.truePeakDbtp}:LRA=${loudnessRangeTarget}:print_format=json`;
}

/** The loudnorm filter for pass two: the measured values, linear normalization, a summary printed on standard error. */
export function loudnormApplyFilter(audio: AudioMix, measured: LoudnessMeasurement): string {
  return `loudnorm=I=${audio.loudnessLufs}:TP=${audio.truePeakDbtp}:LRA=${loudnessRangeTarget}:measured_I=${measured.inputI}:measured_TP=${measured.inputTp}:measured_LRA=${measured.inputLra}:measured_thresh=${measured.inputThresh}:offset=${measured.targetOffset}:linear=true:print_format=summary`;
}

/** Reads the JSON block loudnorm printed at the end of its analysis pass; undefined when there is none. */
export function parseLoudnormJson(stderr: string): LoudnessMeasurement | undefined {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stderr.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Readonly<Record<string, unknown>>;
  const field = (name: string): string | undefined => {
    const value = record[name];
    return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? value : undefined;
  };
  const inputI = field('input_i');
  const inputTp = field('input_tp');
  const inputLra = field('input_lra');
  const inputThresh = field('input_thresh');
  const targetOffset = field('target_offset');
  if (inputI === undefined || inputTp === undefined || inputLra === undefined || inputThresh === undefined || targetOffset === undefined) return undefined;
  return { inputI, inputTp, inputLra, inputThresh, targetOffset };
}

/** Reads "Output Integrated: <n> LUFS" from loudnorm's pass-two summary; undefined when absent. */
export function parseOutputIntegrated(stderr: string): number | undefined {
  const match = /Output Integrated:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(stderr);
  const value = match?.[1];
  return value === undefined ? undefined : Number.parseFloat(value);
}
