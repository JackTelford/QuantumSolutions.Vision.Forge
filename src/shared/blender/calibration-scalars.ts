/**
 * The per-lane light scalars of ADR 0008 decision 2 for the blender lane,
 * recorded the way src/shared/three/calibration-scalars.ts records the
 * three lane's: the numbers that turn a rig's relative intensities into
 * Blender's light units so that the 18 percent gray card of the
 * calibration scene measures YAVG 117 ± 5. They are set by rendering the
 * calibration scene and measuring, never derived; the M5 calibration pass
 * records the measurement in docs/evidence/m5/. The record keeps one
 * entry per tone mapping, as the three lane does, so the lanes read
 * alike; on Blender both entries measured the same (see blenderKeyPowerW),
 * unlike three's linear tone mapping.
 */
import type { ToneMapping } from '../contracts/look-bible.ts';

/**
 * The distance in metres the key power is calibrated at: the nearest a
 * rig's lights stand to the anchor (lighting/placement.ts
 * minimumLightDistanceM), which is where the bottle fixture's lights
 * stand. A light further away gets its power scaled by (d / 1.2)², the
 * same irradiance rule the three lane applies as d² / A, so the fill,
 * twice the key's size at a third of its intensity, lights the subject at
 * a third of the key.
 */
export const blenderCalibrationDistanceM = 1.2;

/**
 * The power in watts of an area light of relative intensity 1 (the rig's
 * key) standing at blenderCalibrationDistanceM, per tone mapping. Blender
 * spreads a light's power over its area already, so unlike the three
 * lane's radiance no division by the area enters. Measured on 2026-10-29
 * (Blender 5.2.3, RTX 2060) on the gray card with the product-studio rig
 * balanced to its key, the studio_small_09 HDRI at blenderKeyedHdriStrength
 * and the lens focused on the card (docs/evidence/m5/calibration-tuning.md):
 * at 18 W the card reads 118.2 with Cycles OptiX and 115.5 with EEVEE under
 * AgX, 118.2 and 115.6 under Standard, against 117.3 ± 5; the handed-over
 * 150 W read 195 under AgX and clipped under Standard. One value serves both
 * view transforms because Blender's Standard view and AgX put scene-linear
 * 0.18 at the same display value to within a code value, unlike three's
 * linear tone mapping, which needed its own scalar.
 */
export const blenderKeyPowerW: Readonly<Record<ToneMapping, number>> = {
  agx: 18,
  standard: 18,
};

/**
 * The world HDRI's strength when the rig has a key: a touch of ambient,
 * the rig does the lighting, so the shadows and the black patch agree
 * with the three lane, whose keyedEnvironmentIntensity is 0.05
 * (src/shared/three/calibration-scalars.ts). It starts at that value;
 * the M5 calibration pass measures the black patch under the studio HDRI
 * and replaces it if Blender's world reads differently from three's
 * environment map. A rig without a key uses its own ambient instead
 * (lanes/blender/world.ts hdriStrengthOf).
 */
export const blenderKeyedHdriStrength = 0.05;
