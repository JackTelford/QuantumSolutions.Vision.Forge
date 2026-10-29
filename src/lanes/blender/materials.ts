/**
 * The Principled BSDF materials of a blender-scene document, every socket
 * given: the subject's body and cap and the stage surface from the look's
 * palette with the same roughness, metallic and coat numbers the three
 * lane uses (src/shared/three/materials.ts), and the calibration patches
 * and spheres of ADR 0008. Palette colours are sRGB hex and Blender's
 * sockets take linear light, so every colour passes through
 * color/srgb.ts. Pure.
 */
import type { CalibrationPatch, CalibrationSphere } from '../../shared/calibration/scene.ts';
import { hexToLinearRgb, neutralLinearRgb } from '../../shared/color/srgb.ts';
import type { LinearRgb } from '../../shared/color/srgb.ts';
import type { Material } from '../../shared/contracts/blender-scene.ts';
import type { Palette } from '../../shared/look/css-tokens.ts';
import type { PartMaterial } from '../../shared/subject/primitives.ts';

/** The names the subject's parts and the stage mesh refer to their materials by. */
export const materialNames = { body: 'body', cap: 'cap', surface: 'surface' } as const;

/** The index of refraction of every dielectric here: 1.45, Blender's default, a plastic or glass surface. */
export const dielectricIor = 1.45;

/** The coat's roughness where a material has a coat: the three lane's clearcoatRoughness. */
export const coatRoughness = 0.2;

/** A black, switched-off emission: every material here is lit by the rig, none glows. */
const noEmission: LinearRgb = { r: 0, g: 0, b: 0 };

/** An opaque Principled BSDF with the given base colour, roughness, metallic and coat weight; no transmission, no emission. */
export function principled(name: string, baseColor: LinearRgb, roughness: number, metallic: number, coatWeight: number): Material {
  return {
    name,
    baseColor,
    metallic,
    roughness,
    ior: dielectricIor,
    transmission: 0,
    coatWeight,
    coatRoughness,
    emissionColor: noEmission,
    emissionStrength: 0,
  };
}

/** The material of a subject part: the body is the primary colour under a clear coat, a little metallic so the key reads as a sheen; the cap is the highlight colour, mostly metal. */
export function subjectMaterial(part: PartMaterial, palette: Palette): Material {
  if (part === 'cap') return principled(materialNames.cap, hexToLinearRgb(palette.highlight), 0.25, 0.8, 0);
  return principled(materialNames.body, hexToLinearRgb(palette.primary), 0.35, 0.1, 0.6);
}

/** The stage's material: the surface colour, rough and not metallic, so the lit gradient is the lights' work. */
export function surfaceMaterial(palette: Palette): Material {
  return principled(materialNames.surface, hexToLinearRgb(palette.surface), 0.9, 0, 0);
}

/** The three materials a product shot uses, in the order the objects name them. */
export function subjectMaterials(palette: Palette): readonly Material[] {
  return [subjectMaterial('body', palette), subjectMaterial('cap', palette), surfaceMaterial(palette)];
}

/** The material name of a calibration element. */
export function calibrationMaterialName(id: string): string {
  return `calibration-${id}`;
}

/** A calibration patch: a perfectly rough, non-metallic surface of its linear reflectance (the neutral patches) or of its sRGB colour decoded to linear light (the swatches), so what the camera sees is the lights' doing. */
export function calibrationPatchMaterial(patch: Pick<CalibrationPatch, 'id' | 'hex' | 'linearReflectance'>): Material {
  const baseColor = patch.linearReflectance === null ? hexToLinearRgb(patch.hex) : neutralLinearRgb(patch.linearReflectance);
  return principled(calibrationMaterialName(patch.id), baseColor, 1, 0, 0);
}

/** A calibration sphere: its colour at the scene's roughness, non-metallic, no coat. */
export function calibrationSphereMaterial(sphere: Pick<CalibrationSphere, 'id' | 'hex' | 'roughness'>): Material {
  return principled(calibrationMaterialName(sphere.id), hexToLinearRgb(sphere.hex), sphere.roughness, 0, 0);
}
