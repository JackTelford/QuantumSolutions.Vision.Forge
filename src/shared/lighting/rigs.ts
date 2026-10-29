/**
 * The sixteen rigs of lighting/cookbook.md as numbers, one record per
 * LightingPreset, plus the per-shot overrides the cookbook allows. Every
 * lane maps a rig to its own lights: Blender to area lights, three to
 * RectAreaLights, the html lane to a gradient, a shadow offset and a sheen
 * (look/css-tokens.ts). Azimuth is measured around the subject from the
 * camera: 0 is behind the camera, 90 camera-right, 180 behind the subject.
 * Elevation is above the subject's centre. Size is the light's diameter in
 * metres at one metre of subject height. Intensity is relative to the key.
 */
import type { Lighting, LightingPreset } from '../contracts/shot-spec.ts';

/** One light of a rig: where it sits, how big and warm it is, and its strength relative to the key. */
export interface RigLight {
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  readonly sizeM: number;
  readonly kelvin: number;
  readonly intensity: number;
  /** A colour that replaces the Kelvin tint for the neon rigs, as lowercase hex; null for a blackbody colour. */
  readonly tint: string | null;
}

/** One row of the cookbook table. */
export interface LightingRig {
  readonly preset: LightingPreset;
  /** The key light; null for the rigs that have none (rim-only, contre-jour, practical-glow). */
  readonly key: RigLight | null;
  /** The key-to-fill ratio as one number: 4 means the key is four times the fill; 1 for rigs without a key. */
  readonly fillRatio: number;
  /** The fill's colour temperature and, when the cookbook places it, its azimuth; null when the rig has no fill. */
  readonly fill: { readonly kelvin: number; readonly azimuthDeg: number | null } | null;
  readonly rims: readonly RigLight[];
  /** An exposure offset the whole rig carries, in EV; the cookbook gives high-key plus one stop. */
  readonly exposureEv: number;
  readonly backdrop: string;
  readonly description: string;
}

const magenta = '#ff2bd6';
const cyan = '#2be5ff';

function light(azimuthDeg: number, elevationDeg: number, sizeM: number, kelvin: number, intensity: number, tint: string | null = null): RigLight {
  return { azimuthDeg, elevationDeg, sizeM, kelvin, intensity, tint };
}

function fill(kelvin: number, azimuthDeg: number | null = null): LightingRig['fill'] {
  return { kelvin, azimuthDeg };
}

/**
 * The cookbook's rigs. soft-cross is two equal front lights at 60 and 300
 * degrees: the second is recorded as a 1:1 fill at 300, which is what it
 * does; a lane that places lights (three, Blender) reads the azimuth.
 * practical-glow lights the subject from its own surface, so it has no key
 * and the html lane shows it as an ambient gradient.
 */
export const lightingRigs: Readonly<Record<LightingPreset, LightingRig>> = {
  'product-studio': { preset: 'product-studio', key: light(45, 35, 1.2, 5600, 1), fillRatio: 3, fill: fill(5600), rims: [light(135, 50, 0.6, 6500, 0.6)], exposureEv: 0, backdrop: 'seamless cyc, gradient', description: 'clean, commercial' },
  'three-point-soft': { preset: 'three-point-soft', key: light(45, 35, 1, 5600, 1), fillRatio: 4, fill: fill(5600), rims: [light(135, 50, 0.5, 5600, 0.5)], exposureEv: 0, backdrop: 'any', description: 'the neutral default' },
  rembrandt: { preset: 'rembrandt', key: light(45, 45, 0.6, 5000, 1), fillRatio: 8, fill: fill(5000), rims: [light(150, 40, 0.4, 5600, 0.4)], exposureEv: 0, backdrop: 'dark', description: 'sculpted, serious' },
  butterfly: { preset: 'butterfly', key: light(0, 50, 1, 5600, 1), fillRatio: 3, fill: fill(5600), rims: [], exposureEv: 0, backdrop: 'light', description: 'glamour, symmetry; the fill comes from below' },
  split: { preset: 'split', key: light(90, 20, 0.5, 5000, 1), fillRatio: 16, fill: fill(5000), rims: [], exposureEv: 0, backdrop: 'dark', description: 'drama, halves' },
  'rim-only': { preset: 'rim-only', key: null, fillRatio: 1, fill: null, rims: [light(135, 45, 0.6, 6500, 1), light(225, 45, 0.6, 6500, 1)], exposureEv: 0, backdrop: 'black', description: 'silhouette, edge' },
  'contre-jour': { preset: 'contre-jour', key: null, fillRatio: 6, fill: fill(5600), rims: [light(180, 30, 2, 5600, 1)], exposureEv: 0, backdrop: 'haze', description: 'backlit glow, atmosphere; the fill is ambient' },
  window: { preset: 'window', key: light(60, 30, 2, 4800, 1), fillRatio: 3, fill: fill(3200), rims: [], exposureEv: 0, backdrop: 'warm wall', description: 'daylight through glass' },
  'soft-cross': { preset: 'soft-cross', key: light(60, 30, 1, 5600, 1), fillRatio: 1, fill: fill(5600, 300), rims: [], exposureEv: 0, backdrop: 'mid', description: 'even, informational; the second light at 300 degrees is the 1:1 fill' },
  'high-key': { preset: 'high-key', key: light(30, 40, 2, 6000, 1), fillRatio: 1.5, fill: fill(6000), rims: [light(180, 60, 2, 6500, 0.4)], exposureEv: 1, backdrop: 'white cyc', description: 'bright, optimistic' },
  'low-key': { preset: 'low-key', key: light(60, 40, 0.5, 4500, 1), fillRatio: 12, fill: fill(4500), rims: [light(160, 45, 0.3, 5600, 0.6)], exposureEv: 0, backdrop: 'black', description: 'moody, premium' },
  'golden-hour': { preset: 'golden-hour', key: light(100, 12, 1.5, 3200, 1), fillRatio: 4, fill: fill(8000), rims: [light(170, 20, 1, 3000, 0.8)], exposureEv: 0, backdrop: 'warm gradient', description: 'warmth, nostalgia; the fill is the sky' },
  'overcast-soft': { preset: 'overcast-soft', key: light(0, 70, 4, 6500, 1), fillRatio: 1.2, fill: fill(6500), rims: [], exposureEv: 0, backdrop: 'gray cyc', description: 'neutral, honest' },
  'neon-night': { preset: 'neon-night', key: light(70, 25, 0.3, 2200, 1, magenta), fillRatio: 6, fill: fill(12000), rims: [light(250, 30, 0.3, 12000, 1, cyan)], exposureEv: 0, backdrop: 'dark, wet-look floor', description: 'synthetic, night' },
  'practical-glow': { preset: 'practical-glow', key: null, fillRatio: 10, fill: fill(5600), rims: [], exposureEv: 0, backdrop: 'dark', description: 'the product is the light; the fill is ambient' },
  'neon-rim': { preset: 'neon-rim', key: light(30, 30, 0.4, 5600, 0.5), fillRatio: 8, fill: fill(5600), rims: [light(120, 40, 0.3, 6500, 1, magenta), light(240, 40, 0.3, 6500, 1, cyan)], exposureEv: 0, backdrop: 'black', description: 'edge-lit, graphic' },
};

/**
 * The rig with a shot's overrides applied: the key's intensity multiplied
 * by keyIntensity and its colour temperature replaced by kelvin, the fill
 * ratio replaced, every rim's intensity multiplied by rimIntensity. A rig
 * without a key keeps no key; the kelvin override has nothing to tint then.
 * A tinted key (the neon rigs) keeps its tint, and the tint wins over the
 * colour temperature wherever a lane colours by the key, so the kelvin
 * override changes the number but not the colour of a neon key.
 */
export function applyLightingOverrides(rig: LightingRig, lighting: Lighting): LightingRig {
  return {
    ...rig,
    key: rig.key === null ? null : { ...rig.key, intensity: rig.key.intensity * lighting.keyIntensity, kelvin: lighting.kelvin },
    fillRatio: lighting.fillRatio,
    rims: rig.rims.map((rim) => ({ ...rim, intensity: rim.intensity * lighting.rimIntensity })),
  };
}

/** The rig a shot lights with: the preset's row with the shot's overrides applied. */
export function shotLightingRig(lighting: Lighting): LightingRig {
  return applyLightingOverrides(lightingRigs[lighting.preset], lighting);
}

/**
 * The azimuth the light comes from, for lanes that draw one direction: the
 * key's, or the first rim's for a rig without a key, or 180 (from behind
 * the subject) when it has neither.
 */
export function dominantAzimuthDeg(rig: LightingRig): number {
  if (rig.key !== null) return rig.key.azimuthDeg;
  const rim = rig.rims[0];
  return rim === undefined ? 180 : rim.azimuthDeg;
}
