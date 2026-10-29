/**
 * Shared inputs for the composition tests: a typed product hero shot of a
 * 0.25 m bottle (MS at 85 mm), the 1080p render spec, a text element
 * builder and the tolerance assertion.
 */
import assert from 'node:assert/strict';
import type { RenderSpec } from '../../../src/shared/camera/types.ts';
import type { BoundsM, Shot, TextElement } from '../../../src/shared/contracts/shot-spec.ts';

/** 1920 × 1080 at 30 fps. */
export const renderSpec: RenderSpec = { fps: 30, width: 1920, height: 1080 };

/** The aspect ratio of the render spec. */
export const aspect = renderSpec.width / renderSpec.height;

/** The bottle's bounding box in metres. */
export const bottleBounds: BoundsM = { w: 0.08, h: 0.25, d: 0.08 };

/** A full 60-frame hero shot: MS, eye level, 85 mm f/4, static hold, the subject on the left third with 10 percent headroom and text on the right; override what a test needs. */
export function makeShot(changes: Partial<Shot> = {}): Shot {
  return {
    id: 's01',
    title: 'Hero hold',
    lane: 'three',
    durationFrames: 60,
    size: 'MS',
    angle: 'eye',
    dutchDegrees: 0,
    lens: { focalMm: 85, fStop: 4, focusDistanceM: 2.2, shutterAngleDeg: 180 },
    move: { preset: 'static-hold', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: null },
    lighting: { preset: 'product-studio', keyIntensity: 1, fillRatio: 4, rimIntensity: 0.8, kelvin: 5600 },
    exposureOffsetEv: 0,
    composition: { anchor: 'thirds-left', headroomPct: 10, leadRoomPct: 15, textSide: 'right' },
    text: [],
    subject: { assetId: null, primitive: 'bottle', boundsM: bottleBounds },
    atmosphere: { haze: 0, motes: 0 },
    narrationEvent: null,
    seed: 7,
    renderProfile: null,
    ...changes,
  };
}

/** A title on the right side of the frame, 0.1 of the frame tall (108 px at 1080p), well inside title safe; override what a test needs. */
export function makeText(changes: Partial<TextElement> = {}): TextElement {
  return {
    id: 't1',
    role: 'title',
    content: 'Now in 500 ml',
    box: { x: 0.55, y: 0.4, w: 0.35, h: 0.1 },
    animation: 'fade-rise',
    staggerMs: 0,
    inFrame: 12,
    outFrame: null,
    ...changes,
  };
}

/** Asserts |actual − expected| <= epsilon with a message that shows both numbers. */
export function assertClose(actual: number, expected: number, epsilon: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: expected ${expected} ± ${epsilon}, got ${actual}`);
}

/** The problems whose sentence contains the phrase, for asserting on one check at a time. */
export function problemsAbout(problems: readonly string[], phrase: string): readonly string[] {
  return problems.filter((problem) => problem.includes(phrase));
}
