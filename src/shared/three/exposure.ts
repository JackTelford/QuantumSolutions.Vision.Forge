/**
 * The three lane's exposure. 0 EV is the calibrated exposure: the light
 * scalars (calibration-scalars.ts) are measured at toneMappingExposure 1,
 * and every stop the look or the shot asks for doubles or halves it. The
 * baked frame's exposureEv already is the shot's exposureOffsetEv
 * (camera/bake.ts writes it per frame), so the shot's field is not added a
 * second time.
 */
import type { CameraFrame } from '../camera/types.ts';
import type { LookBible } from '../contracts/look-bible.ts';

/** The renderer's toneMappingExposure for a frame: 2 to the power of the look's EV plus the frame's. */
export function toneMappingExposure(look: Pick<LookBible, 'exposureEv'>, frame: Pick<CameraFrame, 'exposureEv'>): number {
  return 2 ** (look.exposureEv + frame.exposureEv);
}
