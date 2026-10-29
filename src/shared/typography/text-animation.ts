/**
 * The six text animations of typography/system.md as pure functions of the
 * frame number: each has a fixed duration and easing, enters at the
 * element's inFrame, holds, and leaves before outFrame by mirroring its
 * entrance at two thirds of the duration with `standard-accelerate`. The
 * html lane turns the state into inline styles; nothing here touches the
 * DOM, so node:test covers every frame.
 */
import type { EasingToken, TextAnimation, TextElement } from '../contracts/shot-spec.ts';
import { ease } from '../motion/easing.ts';

/** The entrance duration of each animation in milliseconds (0 for none, which appears at inFrame). */
export const textAnimationDurationsMs: Readonly<Record<TextAnimation, number>> = {
  none: 0,
  'fade-rise': 450,
  'blur-in': 500,
  'mask-wipe': 600,
  'tracking-in': 800,
  'stagger-words': 450,
  counter: 1200,
};

/** The entrance easing of each animation. */
export const textAnimationEasings: Readonly<Record<TextAnimation, EasingToken>> = {
  none: 'linear',
  'fade-rise': 'emphasized-decelerate',
  'blur-in': 'standard-decelerate',
  'mask-wipe': 'emphasized',
  'tracking-in': 'emphasized-decelerate',
  'stagger-words': 'emphasized-decelerate',
  counter: 'standard-decelerate',
};

/** Exits run at this fraction of the entrance duration. */
export const exitDurationFraction = 2 / 3;

/** The easing every exit uses. */
export const exitEasing: EasingToken = 'standard-accelerate';

/** The rise of `fade-rise` at 1080p, in pixels; scales with the frame height. */
export const fadeRisePx = 24;

/** The starting blur of `blur-in` at 1080p, in pixels; scales with the frame height. */
export const blurInPx = 8;

/** The extra letter spacing `tracking-in` starts from, in em. */
export const trackingInEm = 0.3;

/** Where an element is in its life at a frame. */
export type TextPhase = 'before' | 'entering' | 'hold' | 'exiting' | 'after';

/** The style of a text element (or one of its words) at a frame, as numbers the lane writes into CSS. */
export interface TextStyleState {
  readonly phase: TextPhase;
  /** 0 when the element is not shown. */
  readonly opacity: number;
  /** Vertical offset in pixels, positive downward (fade-rise starts below its place). */
  readonly translateYPx: number;
  /** Gaussian blur radius in pixels. */
  readonly blurPx: number;
  /** Letter spacing added to the role's tracking, in em. */
  readonly trackingEmExtra: number;
  /** Fraction of the element revealed along the reading direction, 0 to 1 (mask-wipe); 1 for the others. */
  readonly revealFraction: number;
  /** Fraction of a counter's value shown, 0 to 1 (counter); 1 for the others. */
  readonly counterFraction: number;
}

/** The element is not on screen. */
export const hiddenState: TextStyleState = { phase: 'before', opacity: 0, translateYPx: 0, blurPx: 0, trackingEmExtra: 0, revealFraction: 0, counterFraction: 0 };

/** The element is fully on screen. */
export const shownState: TextStyleState = { phase: 'hold', opacity: 1, translateYPx: 0, blurPx: 0, trackingEmExtra: 0, revealFraction: 1, counterFraction: 1 };

/** Milliseconds as whole frames at a frame rate (rounded, at least 0). */
export function millisecondsToFrames(ms: number, fps: number): number {
  return Math.max(0, Math.round((ms * fps) / 1000));
}

/** The entrance length of an animation in frames; 0 for none. */
export function entranceFrames(animation: TextAnimation, fps: number): number {
  return millisecondsToFrames(textAnimationDurationsMs[animation], fps);
}

/** The exit length of an animation in frames: two thirds of the entrance; 0 for none. */
export function exitFrames(animation: TextAnimation, fps: number): number {
  return millisecondsToFrames(textAnimationDurationsMs[animation] * exitDurationFraction, fps);
}

/** The per-word delay in frames for stagger-words; 0 for every other animation. */
export function wordDelayFrames(animation: TextAnimation, staggerMs: number, fps: number): number {
  return animation === 'stagger-words' ? millisecondsToFrames(staggerMs, fps) : 0;
}

/** The state of an entrance or exit at eased progress p (0 hidden, 1 shown) for an animation; sizes at the given frame height. */
export function stateAtProgress(animation: TextAnimation, p: number, heightPx: number, phase: TextPhase): TextStyleState {
  const scale = heightPx / 1080;
  switch (animation) {
    case 'none':
      return { ...(p >= 1 ? shownState : hiddenState), phase };
    case 'fade-rise':
    case 'stagger-words':
      return { phase, opacity: p, translateYPx: (1 - p) * fadeRisePx * scale, blurPx: 0, trackingEmExtra: 0, revealFraction: 1, counterFraction: 1 };
    case 'blur-in':
      return { phase, opacity: p, translateYPx: 0, blurPx: (1 - p) * blurInPx * scale, trackingEmExtra: 0, revealFraction: 1, counterFraction: 1 };
    case 'mask-wipe':
      return { phase, opacity: 1, translateYPx: 0, blurPx: 0, trackingEmExtra: 0, revealFraction: p, counterFraction: 1 };
    case 'tracking-in':
      return { phase, opacity: p, translateYPx: 0, blurPx: 0, trackingEmExtra: (1 - p) * trackingInEm, revealFraction: 1, counterFraction: 1 };
    case 'counter':
      return { phase, opacity: 1, translateYPx: 0, blurPx: 0, trackingEmExtra: 0, revealFraction: 1, counterFraction: p };
    default:
      return { ...shownState, phase };
  }
}

/** The timing of one text element (or one of its words, delayed by its index): the frames its entrance and exit span. */
export interface TextTiming {
  readonly enterStart: number;
  /** First frame of the hold (the entrance is finished). */
  readonly enterEnd: number;
  /** First frame of the exit, or null when the element stays until the shot ends. */
  readonly exitStart: number | null;
  /** First frame after the element, or null. */
  readonly exitEnd: number | null;
}

/** The timing of an element's word at a frame rate; word 0 for an undivided element. */
export function textTiming(element: Pick<TextElement, 'animation' | 'inFrame' | 'outFrame' | 'staggerMs'>, fps: number, wordIndex = 0): TextTiming {
  const enterStart = element.inFrame + wordIndex * wordDelayFrames(element.animation, element.staggerMs, fps);
  const enterEnd = enterStart + entranceFrames(element.animation, fps);
  if (element.outFrame === null) return { enterStart, enterEnd, exitStart: null, exitEnd: null };
  const exitEnd = element.outFrame;
  const exitStart = Math.max(enterEnd, exitEnd - exitFrames(element.animation, fps));
  return { enterStart, enterEnd, exitStart, exitEnd };
}

/**
 * The style of a text element's word at a frame: hidden before inFrame and
 * from outFrame on, eased in over the entrance, held, eased out over the
 * exit (the entrance mirrored). `heightPx` scales the pixel values.
 */
export function textState(element: Pick<TextElement, 'animation' | 'inFrame' | 'outFrame' | 'staggerMs'>, frame: number, fps: number, heightPx: number, wordIndex = 0): TextStyleState {
  const timing = textTiming(element, fps, wordIndex);
  if (frame < timing.enterStart) return hiddenState;
  if (timing.exitEnd !== null && frame >= timing.exitEnd) return { ...hiddenState, phase: 'after' };
  if (frame < timing.enterEnd) {
    const t = (frame - timing.enterStart) / (timing.enterEnd - timing.enterStart);
    return stateAtProgress(element.animation, ease(textAnimationEasings[element.animation], t), heightPx, 'entering');
  }
  if (timing.exitStart !== null && timing.exitEnd !== null && frame >= timing.exitStart) {
    const length = timing.exitEnd - timing.exitStart;
    if (length <= 0) return { ...hiddenState, phase: 'after' };
    const t = (frame - timing.exitStart) / length;
    return stateAtProgress(element.animation, 1 - ease(exitEasing, t), heightPx, 'exiting');
  }
  return shownState;
}

/** The words of a text, split on runs of whitespace; an empty text has none. */
export function splitWords(content: string): readonly string[] {
  return content.split(/\s+/).filter((word) => word.length > 0);
}

/** The integer value a counter shows at a fraction of its target: the digits of the content, rounded, with the content's own prefix and suffix kept. */
export function counterText(content: string, fraction: number): string {
  const match = /^(\D*)(\d[\d,]*)(.*)$/.exec(content);
  if (match === null) return content;
  const digits = (match[2] ?? '').replace(/,/g, '');
  const target = Number(digits);
  const value = Math.round(target * Math.min(1, Math.max(0, fraction)));
  const grouped = (match[2] ?? '').includes(',') ? value.toLocaleString('en-US') : String(value);
  return `${match[1] ?? ''}${grouped}${match[3] ?? ''}`;
}
