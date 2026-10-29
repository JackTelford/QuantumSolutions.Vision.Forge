/**
 * Shared inputs for the camera tests: a fully typed hero shot of a 0.25 m
 * bottle (MS at 85 mm, the product-hero defaults of lens-and-exposure.md),
 * the render spec, the base pose the composition solver would hand to the
 * baker, and a tolerance assertion.
 */
import assert from 'node:assert/strict';
import type { BoundsM, CameraMove, Lens, Move, Shot } from '../../../src/shared/contracts/shot-spec.ts';
import { verticalFovDegrees } from '../../../src/shared/camera/model.ts';
import { cameraMoves } from '../../../src/shared/camera/moves.ts';
import { distanceForSize, placeCamera } from '../../../src/shared/camera/placement.ts';
import type { BasePose, CameraFrame, RenderSpec, Vector3 } from '../../../src/shared/camera/types.ts';
import { zeroVector } from '../../../src/shared/camera/vector.ts';

/** 1920 × 1080 at 30 fps. */
export const renderSpec: RenderSpec = { fps: 30, width: 1920, height: 1080 };

/** The aspect ratio of the render spec. */
export const aspect = renderSpec.width / renderSpec.height;

/** The bottle's bounding box in metres. */
export const bottleBounds: BoundsM = { w: 0.08, h: 0.25, d: 0.08 };

/** The subject's anchor: the centre of its bounding box, at the origin. */
export const anchor: Vector3 = zeroVector;

/** The subject height fraction of an MS, the middle of shot-grammar.md's 0.4 to 0.55. */
export const mediumShotFraction = 0.475;

/** The hero lens: 85 mm at f/4 with a 180 degree shutter. */
export const heroFocalMm = 85;

/** The camera distance that frames the bottle as an MS at 85 mm, about 2.21 m. */
export const heroDistanceM = distanceForSize(bottleBounds.h, mediumShotFraction, verticalFovDegrees(heroFocalMm, aspect));

/** The hero lens with focus on the solved distance. */
export const heroLens: Lens = { focalMm: 85, fStop: 4, focusDistanceM: heroDistanceM, shutterAngleDeg: 180 };

/** A full 60-frame hero shot with a static hold; override what a test needs. */
export function makeShot(changes: Partial<Shot> = {}): Shot {
  return {
    id: 's01',
    title: 'Hero hold',
    lane: 'three',
    durationFrames: 60,
    size: 'MS',
    angle: 'eye',
    dutchDegrees: 0,
    lens: heroLens,
    move: { preset: 'static-hold', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: null },
    lighting: { preset: 'product-studio', keyIntensity: 1, fillRatio: 4, rimIntensity: 0.8, kelvin: 5600 },
    exposureOffsetEv: 0,
    composition: { anchor: 'center', headroomPct: 10, leadRoomPct: 0, textSide: 'none' },
    text: [],
    subject: { assetId: null, primitive: 'bottle', boundsM: bottleBounds },
    atmosphere: { haze: 0, motes: 0 },
    narrationEvent: null,
    seed: 7,
    renderProfile: null,
    ...changes,
  };
}

/** The hero shot with the given move at amplitude 1 over the whole shot, eased by the catalogue default unless `move` says otherwise. */
export function shotWithMove(preset: CameraMove, move: Partial<Omit<Move, 'preset'>> = {}, changes: Partial<Shot> = {}): Shot {
  return makeShot({
    move: { preset, amplitude: 1, easing: cameraMoves[preset].defaultEasing, startFrame: 0, endFrame: null, ...move },
    ...changes,
  });
}

/** The base pose the solver would produce for the shot: on the sphere of the hero distance at the shot's angle, looking at the anchor. */
export function basePoseFor(shot: Shot): BasePose {
  const distanceM = distanceForSize(shot.subject.boundsM.h, mediumShotFraction, verticalFovDegrees(shot.lens.focalMm, aspect));
  return placeCamera(anchor, distanceM, shot.angle, shot.dutchDegrees, shot.subject.boundsM.h);
}

/** The frame at index k of a bake, asserting it exists (the array type allows undefined). */
export function frameAt(frames: readonly CameraFrame[], k: number): CameraFrame {
  const frame = frames[k];
  assert.ok(frame !== undefined, `frame ${k} of ${frames.length}`);
  return frame;
}

/** The element at index k of an array of numbers, asserting it exists. */
export function numberAt(values: readonly number[], k: number): number {
  const value = values[k];
  assert.ok(value !== undefined, `value ${k} of ${values.length}`);
  return value;
}

/** Asserts |actual − expected| <= epsilon with a message that shows both numbers. */
export function assertClose(actual: number, expected: number, epsilon: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: expected ${expected} ± ${epsilon}, got ${actual}`);
}

/** Asserts every component of a vector within epsilon of the expected one. */
export function assertVectorClose(actual: Vector3, expected: Vector3, epsilon: number, label: string): void {
  assertClose(actual.x, expected.x, epsilon, `${label}.x`);
  assertClose(actual.y, expected.y, epsilon, `${label}.y`);
  assertClose(actual.z, expected.z, epsilon, `${label}.z`);
}
