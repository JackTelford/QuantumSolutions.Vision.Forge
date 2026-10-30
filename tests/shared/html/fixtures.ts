/**
 * The html shot of the plan fixtures as a ShotPageSpec, baked the way the
 * harness bakes it: the camera from the composition solver's base pose,
 * the base distance from the same pose. Not a test file.
 */
import { bake } from '../../../src/shared/camera/bake.ts';
import { solveBasePose } from '../../../src/shared/composition/solver.ts';
import type { Shot } from '../../../src/shared/contracts/shot-spec.ts';
import type { ShotPageSpec } from '../../../src/shared/harness/protocol.ts';
import { planLook, planShotSpec } from '../../plan/fixtures.ts';

/** The html title-card shot ("Now in 500 ml") of the plan fixtures. */
export const htmlShot: Shot = (() => {
  const shot = planShotSpec.shots[2];
  if (shot === undefined || shot.lane !== 'html') throw new Error('the plan fixture has no html shot at index 2');
  return shot;
})();

/** The page spec of a shot at the plan fixture's size and rate, baked from the solver's base pose. */
export function pageSpecFor(shot: Shot): ShotPageSpec {
  const spec = { fps: planShotSpec.fps, width: planShotSpec.width, height: planShotSpec.height };
  const base = solveBasePose(shot, spec);
  return {
    lane: 'html',
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
  };
}

/** The title-card page spec. */
export const htmlPageSpec: ShotPageSpec = pageSpecFor(htmlShot);
