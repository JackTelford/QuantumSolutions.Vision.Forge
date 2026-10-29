/**
 * The spec a browser page renders a shot from (src/shared/harness/
 * protocol.ts): the shot, its look, the frame size and rate, the camera
 * baked for every frame from the composition solver's base pose, and the
 * URL prefixes the harness serves fonts and assets under. Pure: the same
 * shot, look and spec always give the same page spec.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';
import { bake } from '../shared/camera/bake.ts';
import type { RenderSpec } from '../shared/camera/types.ts';
import { solveBasePose } from '../shared/composition/solver.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { Shot } from '../shared/contracts/shot-spec.ts';
import { assetsUrlPrefix, fontsUrlPrefix } from '../shared/harness/protocol.ts';
import type { BrowserLane, ShotPageSpec } from '../shared/harness/protocol.ts';

/** A shot asks for a lane this milestone cannot render. */
export class LaneUnavailableError extends VisionForgeError {
  readonly shotId: string;
  readonly lane: string;

  constructor(shotId: string, lane: string) {
    super({
      code: 'lane-unavailable',
      message: `Shot "${shotId}" uses the ${lane} lane, which cannot render yet.`,
      hint: 'The blender lane arrives with milestone M5; until then plan the shot on the html or three lane. See docs/handoff.md.',
    });
    this.shotId = shotId;
    this.lane = lane;
  }
}

/** The shot's lane as a browser lane; throws LaneUnavailableError for the blender lane (M5). */
export function browserLaneOf(shot: Shot): BrowserLane {
  if (shot.lane === 'html' || shot.lane === 'three') return shot.lane;
  throw new LaneUnavailableError(shot.id, shot.lane);
}

/** The page spec of a shot: the camera baked over the solver's base pose, the base distance the html stage scales by, and the harness URL prefixes. */
export function buildShotPageSpec(shot: Shot, look: LookBible, spec: RenderSpec): ShotPageSpec {
  const lane = browserLaneOf(shot);
  const pose = solveBasePose(shot, spec);
  return {
    lane,
    fps: spec.fps,
    width: spec.width,
    height: spec.height,
    shot,
    look,
    camera: bake(shot, spec, pose),
    baseDistanceM: pose.distanceM,
    fontsUrl: fontsUrlPrefix,
    assetsUrl: assetsUrlPrefix,
  };
}
