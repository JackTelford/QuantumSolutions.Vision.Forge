/**
 * The per-lane light scalars of ADR 0008 decision 2 for the three lane:
 * the numbers that turn a rig's relative intensities into three's light
 * units so that the 18 percent gray card of the calibration scene measures
 * YAVG 117 ± 5. They are set by rendering the calibration scene and
 * measuring, never derived; the M4 calibration pass records the
 * measurement in docs/evidence/m4/. One scalar per tone mapping, because
 * AgX and the standard (no tone mapping) output put scene-linear 0.18 at
 * different display values.
 */
import type { ToneMapping } from '../contracts/look-bible.ts';

/**
 * The irradiance a light of relative intensity 1 (the rig's key) delivers
 * at the subject, in three's units: a RectAreaLight's radiance is this
 * times d² / A (lights.ts). Measured on the gray card with the
 * product-studio rig, its lights white-balanced to the key, and the
 * 0.25 m bottle fixture at 0 EV, with the lens focused on the card
 * (docs/evidence/m4/calibration-tuning.md): under the studio_small_09
 * HDRI the card reads 116.6 (agx) and 117.2 (standard), under the room
 * environment 119.8 and 120.2, against 117.3 ± 5.
 */
export const keyIntensityScalar: Readonly<Record<ToneMapping, number>> = {
  agx: 2.57,
  standard: 3.25,
};

/**
 * The DirectionalLight that casts the key's shadow (RectAreaLights cast
 * none): its intensity is this share of the key's relative intensity
 * under the agx scalar, so the shadow reads as the key's without doubling
 * the key's light. Under another tone mapping lights.ts scales it by that
 * tone mapping's key scalar over the agx one, so the shadow light stays
 * the same fraction of the key's light; the key scalars were measured
 * with that scaling in place.
 */
export const shadowKeyShare = 0.6;

/**
 * scene.environmentIntensity when the rig has a key: the environment map
 * is a touch of ambient, the rig does the lighting. Kept small because the
 * built-in room environment is about three times brighter than the studio
 * HDRI, and at 0.25 the gray card could not sit within ±5 under both
 * (measured 2026-10-29: room 0.088 and HDRI 0.031 scene-linear on the
 * card at 0.25). At 0.1 the room card read 122.6, outside the ±5 once the
 * lens was focused on the card; at 0.05 the two environments sit 3 code
 * values apart around the target with one key scalar per tone mapping
 * (docs/evidence/m4/calibration-tuning.md).
 */
export const keyedEnvironmentIntensity = 0.05;
