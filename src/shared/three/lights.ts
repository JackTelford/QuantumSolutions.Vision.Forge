/**
 * The numbers the three lane gives its lights (lighting/cookbook.md, the
 * per-lane mapping): one RectAreaLight per placed light of the rig
 * (lighting/placement.ts), coloured by its tint or its colour temperature
 * and scaled by the calibration scalar of the look's tone mapping; one
 * DirectionalLight along the key for the shadow; and the environment
 * intensity. Pure functions of the placed rig, so Node tests hold them.
 */
import type { Vector3 } from '../camera/types.ts';
import { distance } from '../camera/vector.ts';
import type { ToneMapping } from '../contracts/look-bible.ts';
import type { PlacedLight, PlacedRig } from '../lighting/placement.ts';
import { lightRgb } from '../look/css-tokens.ts';
import type { Rgb } from '../look/css-tokens.ts';
import { keyIntensityScalar, keyedEnvironmentIntensity, shadowKeyShare } from './calibration-scalars.ts';

/** The colour temperature a placed rig is balanced to: its key's, else its first rim's, else the fill's, else 6600 K; the same rule as the html lane's rigWhiteBalanceKelvin. */
export function placedRigWhiteBalanceKelvin(rig: PlacedRig): number {
  return rig.key?.kelvin ?? rig.rims[0]?.kelvin ?? rig.fill?.kelvin ?? 6600;
}

/** The colour of a placed light as sRGB channels 0 to 255: its tint when it has one (the neon rigs), else its black-body colour balanced to the rig's white point (css-tokens.ts whiteBalancedKelvinRgb), so the key renders neutral and the lanes agree on neutrals. */
export function placedLightRgb(light: Pick<PlacedLight, 'tint' | 'kelvin'>, whiteBalanceKelvin: number): Rgb {
  return lightRgb(light, whiteBalanceKelvin);
}

/**
 * The RectAreaLight intensity (three's unit is radiance, nits) of a placed
 * light. The cookbook's relative intensity is what a meter reads on the
 * subject, an irradiance; a panel of area A at distance d delivers
 * E = L · A · cosθ / d², so L = intensity × scalar × d² / A. The fill,
 * twice the key's size at a third of its intensity, then lights the
 * subject at a third of the key, as the ratio says, and a subject whose
 * lights stand nearer (placement.ts clamps the distance at 1.2 m while the
 * sizes keep scaling) is not brighter for it.
 */
export function rectAreaIntensity(light: Pick<PlacedLight, 'intensity' | 'sizeM' | 'position' | 'target'>, toneMapping: ToneMapping): number {
  const distanceM = distance(light.position, light.target);
  return (light.intensity * keyIntensityScalar[toneMapping] * distanceM * distanceM) / (light.sizeM * light.sizeM);
}

/** What the shadow-casting DirectionalLight is set to: where it stands (the key's place) and its intensity. */
export interface ShadowLightSettings {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly intensity: number;
}

/**
 * The shadow light of a placed rig: along the key, at shadowKeyShare of
 * its relative intensity scaled by the ratio of the tone mapping's key
 * scalar to the agx one (the share was measured under agx), so the shadow
 * light is the same fraction of the key's light under every tone mapping;
 * null when the rig has no key.
 */
export function shadowLightSettings(rig: PlacedRig, toneMapping: ToneMapping): ShadowLightSettings | null {
  if (rig.key === null) return null;
  const share = (shadowKeyShare * keyIntensityScalar[toneMapping]) / keyIntensityScalar.agx;
  return { position: rig.key.position, target: rig.key.target, intensity: rig.key.intensity * share };
}

/** scene.environmentIntensity for a placed rig: the rig's ambient strength when it has no key, else the small keyed value. */
export function environmentIntensityOf(rig: PlacedRig): number {
  return rig.key === null ? rig.ambient : keyedEnvironmentIntensity;
}

/** Half the side of the shadow camera's box around the anchor, in metres: 0.75 m (a 1.5 m box) or the subject's height, so a tall subject and its floor shadow stay inside it. */
export function shadowBoxHalfM(subjectHeightM: number): number {
  return Math.max(0.75, subjectHeightM);
}

/** The shadow map's resolution on each side. */
export const shadowMapSize = 2048;

/** The shadow's normal bias in world units, enough to hide acne on the 64-segment cylinders. */
export const shadowNormalBias = 0.02;

/** The near and far planes of the shadow camera for a light at `distanceM` from the anchor over a subject of `subjectHeightM`: the box plus a margin for the floor behind the subject. */
export function shadowCameraRange(distanceM: number, subjectHeightM: number): { readonly near: number; readonly far: number } {
  const half = shadowBoxHalfM(subjectHeightM);
  return { near: Math.max(0.01, distanceM - half - 0.25), far: distanceM + 2 * half };
}
