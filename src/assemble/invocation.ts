/**
 * The ffmpeg argument arrays an assembly needs, built from the plan: the
 * audio mix pass, the loudness analysis pass and the final encode. Pure:
 * every function returns strings; the assembler runs them. Tests assert on
 * these arrays exactly.
 */
import { finishingFilters } from '../finishing/finishing-chain.ts';
import type { AssemblyPlan, AudioMix } from '../shared/contracts/assembly-plan.ts';
import { audioInputArguments, loudnormApplyFilter, loudnormMeasureFilter, mixGraph, mixLabel, normalizedLabel } from './audio.ts';
import type { LoudnessMeasurement } from './audio.ts';
import { captionFilter } from './captions.ts';
import { audioCodecArguments, encodeArguments } from './encode.ts';
import { joinClips } from './graph.ts';
import { allClipFilters, allClipInputArguments } from './normalize.ts';

/** The label of the finished video stream the encoder maps. */
export const finishedLabel = '[v]';

/** The rendered mix and what pass one measured on it; pass two normalizes it inside the encode. */
export interface MeasuredMix {
  readonly audio: AudioMix;
  readonly mixPath: string;
  readonly measured: LoudnessMeasurement;
}

/** Pass one of the audio: render the mix to a WAV (48 kHz stereo float) in the temp directory. */
export function mixArguments(audio: AudioMix, totalFrames: number, fps: number, mixPath: string): readonly string[] {
  return ['-y', ...audioInputArguments(audio), '-filter_complex', mixGraph(audio, totalFrames, fps), '-map', mixLabel, '-c:a', 'pcm_f32le', '-ar', '48000', mixPath];
}

/** Pass two of the audio: measure the mix with loudnorm, writing nothing. */
export function measureArguments(audio: AudioMix, mixPath: string): readonly string[] {
  return ['-i', mixPath, '-af', loudnormMeasureFilter(audio), '-f', 'null', '-'];
}

/**
 * The complete video filter graph: every clip normalized, the clips joined,
 * the finishing chain, then captions burned in (when asked) onto the
 * finished frames, ending in `[v]`. Captions come last so the text is not
 * graded, vignetted or grained; libass draws onto the codec's pixel format.
 * Audio, when present, is input `clips.length` and is normalized with the
 * measured values into `[aout]`.
 */
export function filterGraph(plan: AssemblyPlan, mix: MeasuredMix | undefined): string {
  const joined = joinClips(plan);
  const captions = captionFilter(plan.captions);
  const finishing = [...finishingFilters(plan.grade, plan.output.codec), ...(captions === undefined ? [] : [captions])];
  const chains = [...allClipFilters(plan), ...joined.filters, `${joined.label}${finishing.join(',')}${finishedLabel}`];
  if (mix !== undefined) {
    chains.push(`[${plan.clips.length}:a]${loudnormApplyFilter(mix.audio, mix.measured)}${normalizedLabel}`);
  }
  return chains.join(';');
}

/** The final encode: clip inputs, the mix, the graph, the stream maps, codecs and the output path. */
export function encodeInvocation(plan: AssemblyPlan, mix: MeasuredMix | undefined): readonly string[] {
  const inputs = [...allClipInputArguments(plan), ...(mix === undefined ? [] : ['-i', mix.mixPath])];
  const audioMap = mix === undefined ? [] : ['-map', normalizedLabel, ...audioCodecArguments(plan.output.codec), '-ar', '48000'];
  return ['-y', ...inputs, '-filter_complex', filterGraph(plan, mix), '-map', finishedLabel, ...audioMap, ...encodeArguments(plan.output), plan.output.path];
}
