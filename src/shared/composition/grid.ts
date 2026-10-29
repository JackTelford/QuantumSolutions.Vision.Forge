/**
 * The grid of composition/rules.md as data: where each composition anchor
 * lands in the frame, the tolerance around it, the action-safe and
 * title-safe areas, and the two box predicates the checks use. Every
 * number is a fraction of the frame: x and w of the width, y and h of the
 * height, 0 at the left or top edge and 1 at the right or bottom edge.
 */
import type { FrameBox } from '../camera/types.ts';
import type { CompositionAnchor } from '../contracts/shot-spec.ts';

/** A point in the frame as fractions of the width (x) and the height (y). */
export interface FramePoint {
  readonly x: number;
  readonly y: number;
}

/** Where each composition anchor puts the subject's anchor point (composition/rules.md). */
export const gridPoints: Readonly<Record<CompositionAnchor, FramePoint>> = {
  center: { x: 0.5, y: 0.5 },
  'thirds-left': { x: 0.333, y: 0.5 },
  'thirds-right': { x: 0.667, y: 0.5 },
  'thirds-top': { x: 0.5, y: 0.333 },
  'thirds-bottom': { x: 0.5, y: 0.667 },
  'golden-left': { x: 0.382, y: 0.5 },
  'golden-right': { x: 0.618, y: 0.5 },
};

/** The frame point a composition anchor names. */
export function gridPoint(anchor: CompositionAnchor): FramePoint {
  return gridPoints[anchor];
}

/** How far the projected anchor may sit from its grid point: 4 percent of the frame width. */
export const anchorToleranceFraction = 0.04;

/** The safe areas of EBU R95 / SMPTE ST 2046-1: action safe is the central 93 percent, title safe the central 90 percent. */
export const safeAreas: { readonly action: FrameBox; readonly title: FrameBox } = {
  action: { x: 0.035, y: 0.035, w: 0.93, h: 0.93 },
  title: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
};

/** True when every edge of `inner` lies on or inside the edges of `outer`. */
export function insideBox(inner: FrameBox, outer: FrameBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** True when the two boxes share any area; boxes that only touch along an edge do not overlap. */
export function boxesOverlap(a: FrameBox, b: FrameBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
