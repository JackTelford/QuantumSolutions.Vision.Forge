/**
 * Per-clip ffmpeg input arguments and the filter that brings every clip to
 * the plan's size, frame rate, pixel format and length, so that concat and
 * xfade see identical streams. Pure: builds strings, runs nothing.
 */
import type { AssemblyPlan, Clip } from '../shared/contracts/assembly-plan.ts';

/** The label of clip `index` after normalization, for example `[c0]`. */
export function clipLabel(index: number): string {
  return `[c${index}]`;
}

/**
 * The `-i` arguments for one clip. A frames source is a numbered PNG
 * sequence read at the plan's frame rate from its first number; a video
 * source is the file itself (its own rate is corrected by the clip filter).
 */
export function clipInputArguments(clip: Clip, fps: number): readonly string[] {
  if (clip.source.kind === 'frames') {
    return ['-framerate', String(fps), '-start_number', String(clip.source.startNumber), '-i', clip.source.path];
  }
  return ['-i', clip.source.path];
}

/**
 * The filter chain for clip `index`, reading input `index`: widen
 * anamorphic sources to square pixels (`scale=iw*sar:ih`; an unknown SAR
 * counts as 1), scale to fit inside the delivery size keeping aspect with
 * even dimensions, pad to it with black, pin the sample aspect ratio to 1:1
 * (an inexact fit otherwise leaves a non-square SAR, which concat refuses
 * and xfade silently stamps on the delivery), force the frame rate,
 * yuv420p, trim to the clip's length in frames, and restart timestamps at
 * zero. Labelled `[c<index>]`.
 */
export function clipFilter(plan: AssemblyPlan, clip: Clip, index: number): string {
  const { width, height, fps } = plan;
  const steps = [
    'scale=iw*sar:ih',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${fps}`,
    'format=yuv420p',
    `trim=end_frame=${clip.durationFrames}`,
    'setpts=PTS-STARTPTS',
  ];
  return `[${index}:v]${steps.join(',')}${clipLabel(index)}`;
}

/** Input arguments for every clip in plan order; clip `i` becomes ffmpeg input `i`. */
export function allClipInputArguments(plan: AssemblyPlan): readonly string[] {
  return plan.clips.flatMap((clip) => clipInputArguments(clip, plan.fps));
}

/** The normalization filter of every clip, in plan order. */
export function allClipFilters(plan: AssemblyPlan): readonly string[] {
  return plan.clips.map((clip, index) => clipFilter(plan, clip, index));
}
