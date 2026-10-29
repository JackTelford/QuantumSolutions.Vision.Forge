/**
 * The numbers the three lane gives its lights (lighting/cookbook.md, the
 * per-lane mapping): one RectAreaLight per placed light of the rig
 * (lighting/placement.ts), coloured by its tint or its colour temperature
 * and scaled by the calibration scalar of the look's tone mapping; one
 * DirectionalLight along the key for the shadow; and the environment
 * intensity. Pure functions of the placed rig, so Node tests hold them.
 */
import type { Vector3 } from '../camera/types.ts';
import type { ToneMapping } from '../contracts/look-bible.ts';
import type { PlacedLight, PlacedRig } from '../lighting/placement.ts';
import { hexToRgb, kelvinToRgb } from '../look/css-tokens.ts';
import type { Rgb } from '../look/css-tokens.ts';
import { keyIntensityScalar, keyedEnvironmentIntensity, shadowKeyShare } from './calibration-scalars.ts';

/** The colour of a placed light as sRGB channels 0 to 255: its tint when it has one (the neon rigs), else its black-body colour. */
export function placedLightRgb(light: Pick<PlacedLight, 'tint' | 'kelvin'>): Rgb {
  return light.tint === null ? kelvinToRgb(light.kelvin) : hexToRgb(light.tint);
}

/** The RectAreaLight intensity of a placed light: its relative intensity times the tone mapping's calibration scalar. */
export function rectAreaIntensity(light: Pick<PlacedLight, 'intensity'>, toneMapping: ToneMapping): number {
  return light.intensity * keyIntensityScalar[toneMapping];
}

/** What the shadow-casting DirectionalLight is set to: where it stands (the key's place) and its intensity. */
export interface ShadowLightSettings {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly intensity: number;
}

/** The shadow light of a placed rig: along the key at shadowKeyShare of its relative intensity; null when the rig has no key. */
export function shadowLightSettings(rig: PlacedRig): ShadowLightSettings | null {
  if (rig.key === null) return null;
  return { position: rig.key.position, target: rig.key.target, intensity: rig.key.intensity * shadowKeyShare };
}

/** scene.environmentIntensity for a placed rig: the rig's ambient strength when it has no key, else the small keyed value. */
export function environmentIntensityOf(rig: PlacedRig): number {
  return rig.key === null ? rig.ambient : keyedEnvironmentIntensity;
}

/** Half the side of the shadow camera's box around the anchor, in metres. */
export const shadowBoxHalfM = 0.75;

/** The shadow map's resolution on each side. */
export const shadowMapSize = 2048;

/** The shadow's normal bias in world units, enough to hide acne on the 64-segment cylinders. */
export const shadowNormalBias = 0.02;

/** The near and far planes of the shadow camera for a light at `distanceM` from the anchor: the box plus a margin for the floor behind the subject. */
export function shadowCameraRange(distanceM: number): { readonly near: number; readonly far: number } {
  return { near: Math.max(0.01, distanceM - shadowBoxHalfM - 0.25), far: distanceM + 2 * shadowBoxHalfM };
}
