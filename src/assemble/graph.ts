/**
 * Joins the normalized clips in order into one video stream. A cut (or no
 * transition entry) is a concat; anything else is an xfade whose offset is
 * the length of everything joined so far minus the overlap. The fold is
 * left to right, so N clips give one stream. Pure: builds strings.
 */
import type { AssemblyPlan, Transition, TransitionType } from '../shared/contracts/assembly-plan.ts';
import { frameToSeconds } from '../shared/frame-time.ts';
import { clipLabel } from './normalize.ts';

/** ffmpeg xfade transition names for every non-cut TransitionType. */
export const xfadeNames: Readonly<Record<Exclude<TransitionType, 'cut'>, string>> = {
  dissolve: 'dissolve',
  'fade-black': 'fadeblack',
  'fade-white': 'fadewhite',
  'wipe-left': 'wipeleft',
  'wipe-right': 'wiperight',
  'wipe-up': 'wipeup',
  'wipe-down': 'wipedown',
  'slide-left': 'slideleft',
  'slide-right': 'slideright',
};

/** The label of the fully joined stream when there is more than one clip. */
export const joinedLabel = '[vout]';

/** What joining produced: the filters to add and the label the finishing chain reads from. */
export interface JoinedGraph {
  readonly filters: readonly string[];
  readonly label: string;
}

/** Seconds as ffmpeg reads them in a duration option: up to six decimals, no trailing zeros. */
export function secondsText(frames: number, fps: number): string {
  return frameToSeconds(frames, fps).toFixed(6).replace(/\.?0+$/, '');
}

/** A transition with an overlap: any type but cut. */
export interface OverlapTransition extends Transition {
  readonly type: Exclude<TransitionType, 'cut'>;
}

/** The transition that follows a clip, or undefined for a cut (explicit or absent). */
export function transitionAfter(plan: AssemblyPlan, clipId: string): OverlapTransition | undefined {
  const transition = plan.transitions.find((t) => t.afterClipId === clipId);
  if (transition === undefined || transition.type === 'cut') return undefined;
  return { afterClipId: transition.afterClipId, type: transition.type, frames: transition.frames };
}

/**
 * Builds the join. With one clip nothing is added and its own label is
 * returned. Otherwise each step consumes the running stream and the next
 * clip: `concat=n=2:v=1:a=0,fps=<fps>` for a cut (the fps resets the
 * timebase concat changes, which a following xfade requires) or
 * `xfade=transition=<name>:duration=<s>:offset=<s>`. Intermediate labels
 * are `[j1]`, `[j2]`, ...; the last step writes `[vout]`.
 */
export function joinClips(plan: AssemblyPlan): JoinedGraph {
  const first = plan.clips[0];
  if (first === undefined) return { filters: [], label: clipLabel(0) };
  if (plan.clips.length === 1) return { filters: [], label: clipLabel(0) };
  const filters: string[] = [];
  let current = clipLabel(0);
  let accumulatedFrames = first.durationFrames;
  for (let index = 1; index < plan.clips.length; index += 1) {
    const previous = plan.clips[index - 1];
    const clip = plan.clips[index];
    if (previous === undefined || clip === undefined) break;
    const transition = transitionAfter(plan, previous.id);
    const output = index === plan.clips.length - 1 ? joinedLabel : `[j${index}]`;
    if (transition === undefined) {
      filters.push(`${current}${clipLabel(index)}concat=n=2:v=1:a=0,fps=${plan.fps}${output}`);
      accumulatedFrames += clip.durationFrames;
    } else {
      const offsetFrames = accumulatedFrames - transition.frames;
      filters.push(`${current}${clipLabel(index)}xfade=transition=${xfadeNames[transition.type]}:duration=${secondsText(transition.frames, plan.fps)}:offset=${secondsText(offsetFrames, plan.fps)}${output}`);
      accumulatedFrames += clip.durationFrames - transition.frames;
    }
    current = output;
  }
  return { filters, label: current };
}
