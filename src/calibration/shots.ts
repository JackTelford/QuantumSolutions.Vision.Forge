/**
 * The shots the calibration and lookdev passes render, as data. The
 * calibration shot starts from the reference fixture's product shot
 * (tests/plan/fixtures.ts s01: the 0.08 x 0.25 x 0.08 m bottle at 85 mm
 * f/2.8, eye level, seed 7), so the composition solver puts the camera
 * where it would for a real product; src/ cannot import the test fixture,
 * so the numbers are repeated here. It differs from s01 in five fields,
 * each for the measurement's sake:
 * - size MS instead of MCU, so the whole patch layout fits the anchor plane;
 * - move static-hold instead of push-in, so every frame is the same picture;
 * - lighting from lightingOfPreset: the rig's own fill ratio (3:1 for
 *   product-studio) and full rims, not the fixture's 4:1 and 0.8, so the
 *   three lane's light scalars are tuned under the cookbook's rig as
 *   written, not under one shot's override;
 * - composition anchor center instead of thirds-right, so the patches sit
 *   where the scene's boxes expect them;
 * - atmosphere 0 / 0 instead of haze 0.15 and 200 motes, so nothing hangs
 *   in front of the patches.
 * The lens focus is set afterwards by focusedAtSubject, once the frame
 * size (and so the solver's distance) is known.
 */
import type { RenderSpec } from '../shared/camera/types.ts';
import { solveBasePose } from '../shared/composition/solver.ts';
import type { Lighting, LightingPreset, Shot } from '../shared/contracts/shot-spec.ts';
import type { BrowserLane } from '../shared/harness/protocol.ts';
import { lightingRigs } from '../shared/lighting/rigs.ts';

/** How many frames the calibration shot has: enough for a timing run of a few frames after frame 0. */
export const calibrationFrameCount = 12;

/** The lighting a shot gets to light exactly as the cookbook's preset does: no override changes the rig's own ratio, rims or colour temperature. */
export function lightingOfPreset(preset: LightingPreset): Lighting {
  const rig = lightingRigs[preset];
  return { preset, keyIntensity: 1, fillRatio: rig.fillRatio, rimIntensity: 1, kelvin: rig.key === null ? 5600 : rig.key.kelvin };
}

/**
 * The shot with its lens focused where the solver puts its subject: the
 * bake takes the focus distance from the shot's lens field, and the
 * calibration patches stand on the subject's plane, so a focus set
 * elsewhere (the fixture's 1.2 m under a 2.2 m medium shot) would blur
 * every patch edge into the background and darken the measurement by a
 * few code values. The solver's distance does not depend on the focus.
 */
export function focusedAtSubject(shot: Shot, spec: RenderSpec): Shot {
  return { ...shot, lens: { ...shot.lens, focusDistanceM: solveBasePose(shot, spec).distanceM } };
}

/** The calibration shot on a lane under a lighting: the fixture's bottle, held still, with no text, haze or motes in front of the patches (the differences from s01 are listed in the file header); focus it with focusedAtSubject once the frame size is known. */
export function calibrationShot(lane: BrowserLane, lighting: Lighting): Shot {
  return {
    id: 'calibration',
    title: 'Calibration scene',
    lane,
    durationFrames: calibrationFrameCount,
    // A medium shot rather than the fixture's MCU, so the whole scene (two rows of patches, the swatches) fits the anchor plane the three lane lays it out on.
    size: 'MS',
    angle: 'eye',
    dutchDegrees: 0,
    lens: { focalMm: 85, fStop: 2.8, focusDistanceM: 1.2, shutterAngleDeg: 180 },
    // Held still: frame 0 is the solver's base pose and every later frame repeats it, so a timing run renders the same picture.
    move: { preset: 'static-hold', amplitude: 0, easing: 'linear', startFrame: 0, endFrame: null },
    lighting,
    exposureOffsetEv: 0,
    composition: { anchor: 'center', headroomPct: 10, leadRoomPct: 15, textSide: 'left' },
    text: [],
    subject: { assetId: null, primitive: 'bottle', boundsM: { w: 0.08, h: 0.25, d: 0.08 } },
    atmosphere: { haze: 0, motes: 0 },
    narrationEvent: null,
    seed: 7,
    renderProfile: null,
  };
}
