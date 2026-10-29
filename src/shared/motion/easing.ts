/**
 * Easing tokens as functions of normalized time, the one place every lane
 * and the camera take their curves from. The definitions are the table in
 * skills/cinematic-studio/references/motion/easing-grammar.md: CSS cubic
 * Béziers for the keyword and Material families, a cosine for `sine-in-out`
 * and one canonical spring. Every function maps 0 to 0 and 1 to 1 and is
 * pure, so a frame evaluated twice gives the same number in Node and in the
 * browser.
 */
import type { EasingToken } from '../contracts/shot-spec.ts';

/** A curve over normalized time: 0 at the start, 1 at the end. */
export type EasingFunction = (t: number) => number;

/** The two control points of a CSS `cubic-bezier(x1, y1, x2, y2)`. */
export interface CubicBezier {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** The Bézier tokens with their control points (CSS Easing Level 1 keywords, Material 3 standard and emphasized families). */
export const cubicBezierCurves: Readonly<Record<Exclude<EasingToken, 'linear' | 'sine-in-out' | 'spring'>, CubicBezier>> = {
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  'ease-in': { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  'ease-out': { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  'ease-in-out': { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  standard: { x1: 0.2, y1: 0, x2: 0, y2: 1 },
  'standard-decelerate': { x1: 0, y1: 0, x2: 0, y2: 1 },
  'standard-accelerate': { x1: 0.3, y1: 0, x2: 1, y2: 1 },
  emphasized: { x1: 0.2, y1: 0, x2: 0, y2: 1 },
  'emphasized-decelerate': { x1: 0.05, y1: 0.7, x2: 0.1, y2: 1 },
  'emphasized-accelerate': { x1: 0.3, y1: 0, x2: 0.8, y2: 0.15 },
};

/** Mass of the canonical spring, in the unit system where stiffness 100 gives a 10 rad/s natural frequency. */
export const springMass = 1;
/** Stiffness of the canonical spring. */
export const springStiffness = 100;
/** Damping ratio of the canonical spring: under-damped, one small overshoot. */
export const springDampingRatio = 0.75;
/** The largest overshoot a spring may show above its target, as a fraction; the response is clamped to it. */
export const springOvershootCap = 0.04;
/** Seconds after which the canonical spring's step response stays within 0.1 percent of its target. */
export const springSettleSeconds = Math.log(1000) / (springDampingRatio * Math.sqrt(springStiffness / springMass));

const newtonIterations = 8;
const bisectionIterations = 24;
const newtonTolerance = 1e-7;

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/**
 * The CSS cubic Bézier easing for the given control points: the curve is
 * sampled by its parameter, the parameter whose x equals the input time is
 * found by Newton's method (falling back to bisection), and that parameter's
 * y is the eased value. Inputs outside 0 to 1 are clamped.
 */
export function cubicBezier(curve: CubicBezier): EasingFunction {
  const cx = 3 * curve.x1;
  const bx = 3 * (curve.x2 - curve.x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * curve.y1;
  const by = 3 * (curve.y2 - curve.y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (parameter: number): number => ((ax * parameter + bx) * parameter + cx) * parameter;
  const sampleY = (parameter: number): number => ((ay * parameter + by) * parameter + cy) * parameter;
  const slopeX = (parameter: number): number => (3 * ax * parameter + 2 * bx) * parameter + cx;
  const solveParameter = (x: number): number => {
    let parameter = x;
    for (let i = 0; i < newtonIterations; i += 1) {
      const error = sampleX(parameter) - x;
      if (Math.abs(error) < newtonTolerance) return parameter;
      const slope = slopeX(parameter);
      if (Math.abs(slope) < 1e-6) break;
      parameter -= error / slope;
    }
    let low = 0;
    let high = 1;
    parameter = x;
    for (let i = 0; i < bisectionIterations; i += 1) {
      const error = sampleX(parameter) - x;
      if (Math.abs(error) < newtonTolerance) return parameter;
      if (error > 0) high = parameter;
      else low = parameter;
      parameter = (low + high) / 2;
    }
    return parameter;
  };
  return (t: number): number => {
    const x = clamp01(t);
    if (x === 0 || x === 1) return x;
    return sampleY(solveParameter(x));
  };
}

/** The breathing curve: 0.5 − cos(πt) / 2, zero velocity at both ends. */
export function sineInOut(t: number): number {
  return 0.5 - Math.cos(Math.PI * clamp01(t)) / 2;
}

/**
 * Position of the canonical spring `seconds` after a unit step, from 0
 * toward 1 with one overshoot of about 2.8 percent (clamped at the cap):
 * the under-damped second-order response with natural frequency
 * sqrt(stiffness / mass) and the damping ratio above.
 */
export function springResponse(seconds: number): number {
  if (seconds <= 0) return 0;
  const omega = Math.sqrt(springStiffness / springMass);
  const zeta = springDampingRatio;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * seconds);
  const position = 1 - decay * (Math.cos(damped * seconds) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(damped * seconds));
  return Math.min(position, 1 + springOvershootCap);
}

/** The spring as an easing over normalized time: the step response over its settle time, exactly 1 at t = 1. */
export function springEasing(t: number): number {
  if (t >= 1) return 1;
  return springResponse(clamp01(t) * springSettleSeconds);
}

const bezierFunctions: Readonly<Record<keyof typeof cubicBezierCurves, EasingFunction>> = {
  ease: cubicBezier(cubicBezierCurves.ease),
  'ease-in': cubicBezier(cubicBezierCurves['ease-in']),
  'ease-out': cubicBezier(cubicBezierCurves['ease-out']),
  'ease-in-out': cubicBezier(cubicBezierCurves['ease-in-out']),
  standard: cubicBezier(cubicBezierCurves.standard),
  'standard-decelerate': cubicBezier(cubicBezierCurves['standard-decelerate']),
  'standard-accelerate': cubicBezier(cubicBezierCurves['standard-accelerate']),
  emphasized: cubicBezier(cubicBezierCurves.emphasized),
  'emphasized-decelerate': cubicBezier(cubicBezierCurves['emphasized-decelerate']),
  'emphasized-accelerate': cubicBezier(cubicBezierCurves['emphasized-accelerate']),
};

/** The function behind an easing token; every token of the vocabulary has one. */
export function easingFunction(token: EasingToken): EasingFunction {
  switch (token) {
    case 'linear':
      return clamp01;
    case 'sine-in-out':
      return sineInOut;
    case 'spring':
      return springEasing;
    default:
      return bezierFunctions[token];
  }
}

/** Eases normalized time `t` (clamped to 0..1) with the token. */
export function ease(token: EasingToken, t: number): number {
  return easingFunction(token)(t);
}
