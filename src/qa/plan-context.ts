/**
 * What an assembly plan tells the checks: the expected geometry and length,
 * where each clip sits on the delivery timeline, which clip starts are hard
 * cuts, where fade-to-black transitions put black frames on purpose, and the
 * audio targets. Pure; built once per qa run from a plan the schema and the
 * semantic checks have already accepted.
 */
import { clipStartFrames, totalFrames } from '../schema/checks/assembly-plan.ts';
import type { AssemblyPlan } from '../shared/contracts/assembly-plan.ts';
import type { FrameRange } from './check.ts';
import { secondsToFrame } from './check.ts';

/** One clip as a span of delivery frames. */
export interface ClipRange extends FrameRange {
  readonly id: string;
}

/** The plan facts the checks consume. */
export interface PlanContext {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  /** Delivery length in frames (clips minus transition overlaps). */
  readonly totalFrames: number;
  /** The clips in order, each as the delivery frames it occupies (the next clip's overlap frames belong to the next clip). */
  readonly clips: readonly ClipRange[];
  /** Frames at which a clip begins after a hard cut (no transition entry, or a cut). The first clip's frame 0 is included. */
  readonly cutFrames: readonly number[];
  /** Frame ranges covered by a fade-black transition, where black frames are intended. */
  readonly fadeBlackRanges: readonly FrameRange[];
  /** Indexes of the clips that a non-cut transition follows, so a change across them is intended. */
  readonly transitionAfter: ReadonlySet<number>;
  /** The plan's integrated loudness target in LUFS, when it has audio. */
  readonly loudnessLufs: number | undefined;
  /** The plan's true-peak ceiling in dBTP, when it has audio. */
  readonly truePeakDbtp: number | undefined;
  /** The clips whose shot holds by design (a static-hold or a breathe move): a frozen run inside one is not a stuck render. Empty when the plan was not built from a job. */
  readonly holdRanges: readonly FrameRange[];
}

/** Derives the PlanContext from a plan. */
/** The shot ids whose move holds the camera (static-hold or breathe): their clips are planned holds for the frozen-frames check. */
export function holdShotIds(shots: readonly { readonly id: string; readonly move: { readonly preset: string } }[]): ReadonlySet<string> {
  return new Set(shots.filter((shot) => shot.move.preset === 'static-hold' || shot.move.preset === 'breathe').map((shot) => shot.id));
}

/** The context the checks read from a plan; `holdClipIds` names the clips whose shots hold by design (from the job's shot spec), none for a plan without one. */
export function planContext(plan: AssemblyPlan, holdClipIds: ReadonlySet<string> = new Set()): PlanContext {
  const starts = clipStartFrames(plan);
  const total = totalFrames(plan);
  const clips: ClipRange[] = plan.clips.map((clip, index) => ({ id: clip.id, start: starts[index] ?? 0, end: starts[index + 1] ?? total }));
  const cutFrames: number[] = [];
  const fadeBlackRanges: FrameRange[] = [];
  const transitionAfter = new Set<number>();
  plan.clips.forEach((clip, index) => {
    const transition = plan.transitions.find((t) => t.afterClipId === clip.id);
    const nextStart = starts[index + 1];
    if (index === 0) cutFrames.push(0);
    if (nextStart === undefined) return;
    if (transition === undefined || transition.type === 'cut') {
      cutFrames.push(nextStart);
      return;
    }
    transitionAfter.add(index);
    if (transition.type === 'fade-black') fadeBlackRanges.push({ start: nextStart, end: nextStart + transition.frames });
  });
  return {
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    totalFrames: total,
    clips,
    cutFrames,
    fadeBlackRanges,
    transitionAfter,
    loudnessLufs: plan.audio?.loudnessLufs,
    truePeakDbtp: plan.audio?.truePeakDbtp,
    holdRanges: clips.filter((clip) => holdClipIds.has(clip.id)).map((clip) => ({ start: clip.start, end: clip.end })),
  };
}

/** The last `seconds` of every clip: a hold there is a planned still, not a frozen render. */
export function clipTailRanges(context: PlanContext, seconds: number): readonly FrameRange[] {
  const tail = secondsToFrame(seconds, context.fps);
  return context.clips.map((clip) => ({ start: Math.max(clip.start, clip.end - tail), end: clip.end }));
}
