/**
 * The material parameters of the three lane as data: the subject's body
 * and cap from the look's palette (subject/primitives.ts names which part
 * is which), the stage in the surface colour, the calibration patches and
 * spheres. Colours are sRGB hex; the lane hands them to three's Color,
 * which converts to linear. Kept out of the browser code so a test can
 * read the numbers.
 */
import type { CalibrationSphere } from '../calibration/scene.ts';
import type { Palette } from '../look/css-tokens.ts';
import type { PartMaterial } from '../subject/primitives.ts';

/** The physical parameters a MeshPhysicalMaterial is built from. */
export interface PhysicalParameters {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
}

/** The subject's body: the primary colour under a clear coat, a little metallic so the key reads as a sheen; the cap: the highlight colour, mostly metal. */
export function subjectMaterial(part: PartMaterial, palette: Palette): PhysicalParameters {
  if (part === 'cap') return { color: palette.highlight, roughness: 0.25, metalness: 0.8, clearcoat: 0, clearcoatRoughness: 0 };
  return { color: palette.primary, roughness: 0.35, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2 };
}

/** The floor, the back wall and the cyclorama between them: the surface colour, rough, so the lit gradient comes from the lights alone. */
export function stageMaterial(palette: Palette): { readonly color: string; readonly roughness: number; readonly metalness: number } {
  return { color: palette.surface, roughness: 0.9, metalness: 0 };
}

/** A calibration patch: the patch's own sRGB colour as a perfectly rough, non-metallic surface, so what the camera sees is the lights' doing. */
export function calibrationPatchMaterial(hex: string): { readonly color: string; readonly roughness: number; readonly metalness: number } {
  return { color: hex, roughness: 1, metalness: 0 };
}

/** A calibration sphere: its colour at the scene's roughness, non-metallic. */
export function calibrationSphereMaterial(sphere: Pick<CalibrationSphere, 'hex' | 'roughness'>): PhysicalParameters {
  return { color: sphere.hex, roughness: sphere.roughness, metalness: 0, clearcoat: 0, clearcoatRoughness: 0 };
}
