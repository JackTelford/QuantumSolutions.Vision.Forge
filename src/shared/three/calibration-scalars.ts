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
 * The RectAreaLight intensity (three's physical units, nits) of a light of
 * relative intensity 1, the rig's key. Measured on the gray card with the
 * product-studio rig and the 0.25 m bottle fixture at 0 EV.
 */
export const keyIntensityScalar: Readonly<Record<ToneMapping, number>> = {
  agx: 12,
  standard: 12,
};

/**
 * The DirectionalLight that casts the key's shadow (RectAreaLights cast
 * none): its intensity is this share of the key's relative intensity, so
 * the shadow reads as the key's without doubling the key's light.
 */
export const shadowKeyShare = 0.6;

/** scene.environmentIntensity when the rig has a key: the environment map is a touch of ambient, the rig does the lighting. */
export const keyedEnvironmentIntensity = 0.25;
