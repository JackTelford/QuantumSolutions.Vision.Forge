/**
 * Shared inputs for the three lane tests: the two three shots of the plan
 * fixtures (s01 push-in, s02 turntable) as page specs baked the way the
 * harness bakes them, and a frame-fraction tolerance assertion. Not a
 * test file.
 */
import assert from 'node:assert/strict';
import { bake } from '../../../src/shared/camera/bake.ts';
import { solveBasePose } from '../../../src/shared/composition/solver.ts';
import type { Shot } from '../../../src/shared/contracts/shot-spec.ts';
import type { ShotPageSpec } from '../../../src/shared/harness/protocol.ts';
import { planLook, planShotSpec } from '../../plan/fixtures.ts';

/** The three shot at an index of the plan fixture, asserting its lane. */
function threeShotAt(index: number): Shot {
  const shot = planShotSpec.shots[index];
  if (shot === undefined || shot.lane !== 'three') throw new Error(`the plan fixture has no three shot at index ${String(index)}`);
  return shot;
}

/** s01: the 85 mm f/2.8 push-in on the bottle under product-studio. */
export const pushInShot: Shot = threeShotAt(0);

/** s02: the turntable on the same bottle. */
export const turntableShot: Shot = threeShotAt(1);

/** The page spec of a three shot at the fixture's size and rate, optionally as the calibration scene. */
export function threePageSpecFor(shot: Shot, scene?: 'calibration'): ShotPageSpec {
  const spec = { fps: planShotSpec.fps, width: planShotSpec.width, height: planShotSpec.height };
  const base = solveBasePose(shot, spec);
  return {
    lane: 'three',
    plate: 'picture',
    fps: spec.fps,
    width: spec.width,
    height: spec.height,
    shot,
    look: planLook,
    camera: bake(shot, spec, base),
    baseDistanceM: base.distanceM,
    fontsUrl: '/fonts/',
    assetsUrl: '/assets/',
    environment: null,
    ...(scene === undefined ? {} : { scene }),
  };
}

/** The push-in page spec. */
export const pushInSpec: ShotPageSpec = threePageSpecFor(pushInShot);

/** Asserts two numbers agree within a tolerance, naming what was compared. */
export function assertClose(actual: number, expected: number, tolerance: number, what: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${String(actual)} is not within ${String(tolerance)} of ${String(expected)}`);
}
