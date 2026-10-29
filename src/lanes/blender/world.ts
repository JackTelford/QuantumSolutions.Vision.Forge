/**
 * The world section of a blender-scene document: the installed HDRI at
 * the rig's ambient strength, turned so its brightest side agrees with
 * the rig's key, or a flat world in the look's background colour when no
 * HDRI is installed. Pure.
 */
import { blenderKeyedHdriStrength } from '../../shared/blender/calibration-scalars.ts';
import { toBlenderVector } from '../../shared/camera/blender-axes.ts';
import { hexToLinearRgb } from '../../shared/color/srgb.ts';
import type { BlenderScene } from '../../shared/contracts/blender-scene.ts';
import type { PlacedRig } from '../../shared/lighting/placement.ts';
import type { Palette } from '../../shared/look/css-tokens.ts';
import { forwardSlashes } from './render-settings.ts';

/** The strength of the flat background colour's light: a touch of ambient, the rig does the lighting. */
export const worldColourStrength = 0.2;

/**
 * The strength of the HDRI's light for a placed rig: the rig's ambient (one
 * over its fill ratio) when the rig has no key, since the HDRI is then the
 * fill, else the small keyed value, the same rule as the three lane's
 * environmentIntensityOf (lighting/cookbook.md: the HDRI plays "at the
 * rig's ambient strength"). At full strength a studio HDRI would lift the
 * shadows and the 2 percent black patch far above what the three lane
 * shows at a twentieth of it.
 */
export function hdriStrengthOf(rig: PlacedRig): number {
  return rig.key === null ? rig.ambient : blenderKeyedHdriStrength;
}

/**
 * The rotation about Blender's Z that turns the HDRI's centre column
 * toward the rig's key, in radians. Convention: an equirectangular HDRI's
 * centre column (u = 0.5) is taken as its brightest side, which is where
 * Poly Haven frames a studio's main softbox. Blender reads that column
 * along +X when the mapping is unrotated, and the mapping node turns a
 * lookup direction at angle φ about Z (atan2(y, x)) to φ + θ, so the
 * key's direction reads the centre column when φ + θ = 0, that is θ = −φ.
 * Checked on Blender 5.2.3 by rendering the calibration spheres under a
 * 256x128 environment whose centre column is white and no lights: the
 * s01 key stands at φ = −49°; at θ = +49° the gray card reads brightest
 * (98.8) and the sphere's key side is the lit one, at θ = π − φ the stripe
 * lands behind the subject on the opposite side (57.6). A rig without a
 * key leaves the HDRI unrotated.
 */
export function hdriRotationZRad(rig: PlacedRig): number {
  if (rig.key === null) return 0;
  const key = toBlenderVector(rig.key.position);
  return -Math.atan2(key.y, key.x);
}

/** The world: the HDRI at the rig's ambient strength turned toward the key when a path is given (written with forward slashes, which Blender takes on every platform), else the background colour at a fifth of its strength; the colour is written in both cases, since the applier reads every field. */
export function blenderWorld(palette: Pick<Palette, 'background'>, hdriPath: string | null, rig: PlacedRig): BlenderScene['world'] {
  return {
    color: hexToLinearRgb(palette.background),
    strength: worldColourStrength,
    hdriPath: hdriPath === null ? null : forwardSlashes(hdriPath),
    hdriStrength: hdriStrengthOf(rig),
    hdriRotationZRad: hdriPath === null ? 0 : hdriRotationZRad(rig),
  };
}
