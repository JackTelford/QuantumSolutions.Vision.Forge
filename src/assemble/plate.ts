/**
 * Per-clip plates (ADR 0008 decision 4): every normalized clip is graded
 * on its own (the LUT and the vignette of src/finishing/), brought to the
 * plan's join format (16-bit planar RGB, or 8-bit when a vignette or a
 * text plate makes it so), and, when the clip carries a text plate, the
 * plate's frames are laid over the graded picture. The transitions then
 * join the plated clips and the grain lands on the whole, text included,
 * as film grain would. Pure: builds strings, runs nothing.
 *
 * Inputs are numbered clips first (clip i is input i, normalize.ts), then
 * every overlay in clip order, then the audio mix; the audio's index is
 * therefore videoInputCount(plan).
 */
import { clipGradeFilters, eightBitFormat, joinFormat } from '../finishing/finishing-chain.ts';
import type { AssemblyPlan, Clip } from '../shared/contracts/assembly-plan.ts';
import { clipLabel } from './normalize.ts';

/** The text plate of a clip, when it has one. */
export type ClipOverlay = NonNullable<Clip['overlay']>;

/** The overlay step that lays a text plate over a graded clip: ffmpeg picks the working format from the two inputs (packed RGB with alpha here, so the text keeps full chroma), and the clip is pinned back to 8-bit planar RGB, the join format of any plan with a text plate, so a plated clip and a bare one meet the join in one format. */
export const overlayFilterName = `overlay=format=auto,${eightBitFormat}`;

/** The label of clip `index` once graded and plated, which the join reads, for example `[p0]`. */
export function platedLabel(index: number): string {
  return `[p${index}]`;
}

/** The label of clip `index` graded but not yet plated, for example `[g0]`; used only for a clip with an overlay. */
export function gradedLabel(index: number): string {
  return `[g${index}]`;
}

/** The label of clip `index`'s normalized text plate, for example `[o0]`. */
export function overlayLabel(index: number): string {
  return `[o${index}]`;
}

/** The clip's overlay, or undefined when the field is null or absent. */
export function overlayOf(clip: Clip): ClipOverlay | undefined {
  return clip.overlay === undefined || clip.overlay === null ? undefined : clip.overlay;
}

/** The `-i` arguments of a text plate: a numbered PNG sequence read at the plan's rate from its first number, like a frames source. */
export function overlayInputArguments(overlay: ClipOverlay, fps: number): readonly string[] {
  return ['-framerate', String(fps), '-start_number', String(overlay.startNumber), '-i', overlay.path];
}

/** The input arguments of every overlay, in clip order, after the clips' own. */
export function allOverlayInputArguments(plan: AssemblyPlan): readonly string[] {
  return plan.clips.flatMap((clip) => {
    const overlay = overlayOf(clip);
    return overlay === undefined ? [] : overlayInputArguments(overlay, plan.fps);
  });
}

/** How many video inputs the encode has: the clips plus their overlays; the audio mix, when present, is the input after them. */
export function videoInputCount(plan: AssemblyPlan): number {
  return plan.clips.length + plan.clips.filter((clip) => overlayOf(clip) !== undefined).length;
}

/** The ffmpeg input index of clip `index`'s overlay: after every clip and every earlier clip's overlay. Throws for a clip without one. */
export function overlayInputIndex(plan: AssemblyPlan, index: number): number {
  const clip = plan.clips[index];
  if (clip === undefined || overlayOf(clip) === undefined) throw new RangeError(`Clip ${String(index)} has no overlay.`);
  return plan.clips.length + plan.clips.slice(0, index).filter((earlier) => overlayOf(earlier) !== undefined).length;
}

/**
 * The filter that brings clip `index`'s text plate in step with the clip:
 * rgba kept (the alpha is the plate), the plan's rate, trimmed to the
 * clip's length with timestamps restarted and the rate pinned again, as
 * the clip itself is normalized. Labelled `[o<index>]`.
 */
export function overlayFilter(plan: AssemblyPlan, clip: Clip, index: number): string {
  const steps = ['format=rgba', `fps=${plan.fps}`, `trim=end_frame=${clip.durationFrames}`, 'setpts=PTS-STARTPTS', `fps=${plan.fps}`];
  return `[${overlayInputIndex(plan, index)}:v]${steps.join(',')}${overlayLabel(index)}`;
}

/** The join format of the plan: 8-bit planar RGB once any clip carries a text plate or the grade has a vignette, 16-bit otherwise (src/finishing/finishing-chain.ts). */
export function planJoinFormat(plan: AssemblyPlan): string {
  return joinFormat(plan.grade, plan.clips.some((clip) => overlayOf(clip) !== undefined));
}

/** The grade chain of a clip ending in the plan's join format; the format step is left out when the chain's last format step already is it (lut3d keeps the format it is given), so an ungraded 16-bit clip reads `format=gbrp16le` once. */
function gradeToJoin(plan: AssemblyPlan): string {
  const steps = clipGradeFilters(plan.grade);
  const join = planJoinFormat(plan);
  const lastFormat = steps.filter((step) => step.startsWith('format=')).at(-1);
  return (lastFormat === join ? steps : [...steps, join]).join(',');
}

/**
 * The chains that grade and plate clip `index`: the normalized clip
 * `[c<i>]` through the grade's LUT and vignette into the plan's join
 * format (`[p<i>]`), or, with an overlay, into `[g<i>]` with the plate's
 * chain beside it and a third chain laying the plate over the picture into
 * `[p<i>]`. Every clip ends in the same pixel format, with or without a
 * grade or a plate, so concat and xfade see identical streams.
 */
export function clipPlateFilters(plan: AssemblyPlan, clip: Clip, index: number): readonly string[] {
  const grade = gradeToJoin(plan);
  if (overlayOf(clip) === undefined) return [`${clipLabel(index)}${grade}${platedLabel(index)}`];
  return [
    `${clipLabel(index)}${grade}${gradedLabel(index)}`,
    overlayFilter(plan, clip, index),
    `${gradedLabel(index)}${overlayLabel(index)}${overlayFilterName}${platedLabel(index)}`,
  ];
}

/** The grade and plate chains of every clip, in plan order. */
export function allPlateFilters(plan: AssemblyPlan): readonly string[] {
  return plan.clips.flatMap((clip, index) => clipPlateFilters(plan, clip, index));
}
