/**
 * The shared timeline: the combinators of
 * skills/cinematic-studio/references/motion/easing-grammar.md. Every value
 * is a pure function of an integer frame number counted from 0 within a
 * shot, so Node and the browser compute the same number for the same frame
 * and no function here knows the wall clock. Frames are integers; a window
 * is [startFrame, startFrame + durationFrames) and a segment holds its
 * start value before the window and its end value after it.
 */
import type { EasingToken } from '../contracts/shot-spec.ts';
import { ease, springResponse } from './easing.ts';

/** What `interpolate` returns outside its input range: hold the end values, continue the straight line, or return the frame itself. */
export type ExtrapolateMode = 'clamp' | 'extend' | 'identity';

/** Options of `interpolate`: the easing applied inside the range (default linear) and the behaviour outside it (default clamp). */
export interface InterpolateOptions {
  readonly easing?: EasingToken;
  readonly extrapolate?: ExtrapolateMode;
}

/** A pair [start, end]: a frame range (integers) or a value range (any unit the caller uses). */
export type Range = readonly [number, number];

/** A piece of animation with a frame window; `valueAt` holds the start value before the window and the end value after it. */
export interface Segment {
  /** First frame of the window, an integer counted from 0 within the shot. */
  readonly startFrame: number;
  /** Length of the window in frames, an integer of at least 1. */
  readonly durationFrames: number;
  /** The value at a frame, in the unit the segment was built with. */
  readonly valueAt: (frame: number) => number;
}

/** The input of `spring`: the start and end values, the frame the spring is released and the frame rate that turns frames into seconds. */
export interface SpringOptions {
  readonly from: number;
  readonly to: number;
  readonly startFrame: number;
  readonly fps: number;
}

/** The input of `stagger`: what every item animates from and to (default 0 to 1, a progress) and with which easing (default linear). */
export interface StaggerOptions {
  readonly from?: number;
  readonly to?: number;
  readonly easing?: EasingToken;
}

/** The definition of a `Timeline`: the frame rate and the named events, each a frame number counted from 0. */
export interface TimelineDefinition {
  readonly fps: number;
  readonly events: Readonly<Record<string, number>>;
}

function requireInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer frame count, not ${value}.`);
}

function requirePositiveInteger(value: number, name: string): void {
  requireInteger(value, name);
  if (value < 1) throw new RangeError(`${name} must be at least 1, not ${value}.`);
}

/** A frame rate must be a positive number; 0, a negative number or NaN would turn frames into Infinity or NaN seconds. */
function requireFrameRate(fps: number): void {
  if (!(fps > 0)) throw new RangeError(`fps must be a positive frame rate, not ${fps}.`);
}

/**
 * The core combinator: maps `frame` from the input frame range [in0, in1]
 * to the output value range [out0, out1]. Inside the range the progress
 * (frame − in0) / (in1 − in0), a fraction from 0 to 1, is eased and the
 * output is out0 + (out1 − out0) × eased. Outside the range `extrapolate`
 * decides: `clamp` (default) holds out0 before and out1 after, `extend`
 * continues the straight line out0 + (out1 − out0) × progress with the
 * unclamped, un-eased progress, and `identity` returns the frame itself.
 * The input range must ascend (in1 > in0).
 */
export function interpolate(frame: number, inputRange: Range, outputRange: Range, options: InterpolateOptions = {}): number {
  const [in0, in1] = inputRange;
  const [out0, out1] = outputRange;
  if (!(in1 > in0)) throw new RangeError(`The input range must ascend; got [${in0}, ${in1}].`);
  const progress = (frame - in0) / (in1 - in0);
  const outside = progress < 0 || progress > 1;
  if (outside) {
    const mode = options.extrapolate ?? 'clamp';
    if (mode === 'identity') return frame;
    if (mode === 'extend') return out0 + (out1 - out0) * progress;
    return progress < 0 ? out0 : out1;
  }
  return out0 + (out1 - out0) * ease(options.easing ?? 'linear', progress);
}

/**
 * The canonical spring released at `startFrame`: before it the value is
 * `from`; from it on the value is from + (to − from) × springResponse(s)
 * where s = (frame − startFrame) / fps is the elapsed time in seconds. The
 * response overshoots `to` by up to 4 percent of the travel before
 * settling (easing-grammar.md), so the result is not clamped to the range.
 */
export function spring(frame: number, options: SpringOptions): number {
  requireFrameRate(options.fps);
  if (frame < options.startFrame) return options.from;
  const seconds = (frame - options.startFrame) / options.fps;
  return options.from + (options.to - options.from) * springResponse(seconds);
}

/**
 * A segment that eases from `from` to `to` over the window
 * [startFrame, startFrame + durationFrames): at a frame inside it the
 * progress is (frame − startFrame) / durationFrames, eased with the token;
 * before the window the value is `from`, at and after its end it is `to`.
 */
export function segment(startFrame: number, durationFrames: number, from: number, to: number, easing: EasingToken): Segment {
  requireInteger(startFrame, 'startFrame');
  requirePositiveInteger(durationFrames, 'durationFrames');
  const valueAt = (frame: number): number => {
    if (frame <= startFrame) return from;
    if (frame >= startFrame + durationFrames) return to;
    return from + (to - from) * ease(easing, (frame - startFrame) / durationFrames);
  };
  return { startFrame, durationFrames, valueAt };
}

/** The first frame after a segment's window (exclusive end): startFrame + durationFrames. */
export function segmentEndFrame(item: Segment): number {
  return item.startFrame + item.durationFrames;
}

/** The same segment moved so its window starts at `startFrame`: its value at a frame is the original's value at the same offset into the window. */
export function moveSegment(item: Segment, startFrame: number): Segment {
  requireInteger(startFrame, 'startFrame');
  const shift = startFrame - item.startFrame;
  return { startFrame, durationFrames: item.durationFrames, valueAt: (frame: number): number => item.valueAt(frame - shift) };
}

/**
 * Runs segments one after another: the first keeps its start frame, each
 * following one starts `gapFrames` after the previous one's window ends.
 * The result lists the moved segments in the same order.
 */
export function sequence(segments: readonly Segment[], gapFrames = 0): Segment[] {
  requireInteger(gapFrames, 'gapFrames');
  const timed: Segment[] = [];
  let nextStart: number | undefined;
  for (const item of segments) {
    const moved = nextStart === undefined ? item : moveSegment(item, nextStart);
    timed.push(moved);
    nextStart = segmentEndFrame(moved) + gapFrames;
  }
  return timed;
}

/**
 * The same animation on `count` items, each starting `offsetFrames` after
 * the previous one: item i runs over
 * [startFrame + i × offsetFrames, + perItemDurationFrames). By default each
 * segment is a linear progress from 0 to 1 the caller maps onto its own
 * property; `options` sets other values or an easing.
 */
export function stagger(count: number, perItemDurationFrames: number, offsetFrames: number, startFrame: number, options: StaggerOptions = {}): Segment[] {
  requireInteger(count, 'count');
  if (count < 0) throw new RangeError(`count must be 0 or more, not ${count}.`);
  requirePositiveInteger(perItemDurationFrames, 'perItemDurationFrames');
  requireInteger(offsetFrames, 'offsetFrames');
  requireInteger(startFrame, 'startFrame');
  const items: Segment[] = [];
  for (let index = 0; index < count; index += 1) {
    items.push(segment(startFrame + index * offsetFrames, perItemDurationFrames, options.from ?? 0, options.to ?? 1, options.easing ?? 'linear'));
  }
  return items;
}

/** A hold: a segment of `frames` frames starting at frame 0 whose value is `holdValue` (default 0) everywhere; in a `sequence` it occupies time. */
export function delay(frames: number, holdValue = 0): Segment {
  requirePositiveInteger(frames, 'frames');
  return { startFrame: 0, durationFrames: frames, valueAt: (): number => holdValue };
}

/**
 * Repeats a segment `times` times back to back (turntables, breathing):
 * the window is startFrame to startFrame + durationFrames × times, and
 * inside it the value is the segment's at the same offset into the current
 * cycle. After the last cycle the value is the segment's end value.
 */
export function loop(item: Segment, times: number): Segment {
  requirePositiveInteger(times, 'times');
  const cycle = item.durationFrames;
  const total = cycle * times;
  const valueAt = (frame: number): number => {
    if (frame <= item.startFrame) return item.valueAt(item.startFrame);
    if (frame >= item.startFrame + total) return item.valueAt(item.startFrame + cycle);
    return item.valueAt(item.startFrame + ((frame - item.startFrame) % cycle));
  };
  return { startFrame: item.startFrame, durationFrames: total, valueAt };
}

/**
 * Named time events of a shot (narration sentence boundaries, beats) that
 * segments start from. Events are integer frame numbers counted from 0 at
 * the timeline's frame rate; names are looked up exactly.
 */
export class Timeline {
  /** Frames per second the events are counted at. */
  readonly fps: number;
  private readonly events: Readonly<Record<string, number>>;

  /** Builds a timeline; fps must be a positive frame rate and every event frame an integer of 0 or more, else a RangeError names the offender. */
  constructor(definition: TimelineDefinition) {
    requireFrameRate(definition.fps);
    for (const [name, frame] of Object.entries(definition.events)) {
      requireInteger(frame, `Event "${name}"`);
      if (frame < 0) throw new RangeError(`Event "${name}" must be at frame 0 or later, not ${frame}.`);
    }
    this.fps = definition.fps;
    this.events = { ...definition.events };
  }

  /** The names of every event, in definition order. */
  eventNames(): string[] {
    return Object.keys(this.events);
  }

  /** The frame of the named event; a RangeError names an unknown event. */
  at(name: string): number {
    const frame = Object.hasOwn(this.events, name) ? this.events[name] : undefined;
    if (frame === undefined) throw new RangeError(`Unknown timeline event "${name}"; known events: ${this.eventNames().join(', ') || '(none)'}.`);
    return frame;
  }

  /** Frames from event A to event B: at(B) − at(A), negative when B comes first. */
  between(nameA: string, nameB: string): number {
    return this.at(nameB) - this.at(nameA);
  }

  /** A segment that starts at the named event and eases from `from` to `to` over `durationFrames` frames. */
  segmentFromEvent(name: string, durationFrames: number, from: number, to: number, easing: EasingToken): Segment {
    return segment(this.at(name), durationFrames, from, to, easing);
  }
}
