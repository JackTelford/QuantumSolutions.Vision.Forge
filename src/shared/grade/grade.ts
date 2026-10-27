/**
 * The finishing grade as numbers, and the two things made from it: a
 * per-pixel transfer function and a 3D LUT in .cube format.
 *
 * Pure TypeScript: it runs in Node (to write the .cube that ffmpeg's lut3d
 * applies at assembly) and in the browser (to preview the same grade on a
 * still). Every function is deterministic: the same parameters give the same
 * numbers and the same .cube text.
 *
 * Colour math works in a 0..1 display-referred RGB space. The spatial
 * parameters (vignette, grain, halation) do not change a pixel on its own
 * and are therefore not part of the LUT; the finishing chain in
 * src/finishing/ turns them into ffmpeg filters.
 */
import type { Grade } from '../contracts/look-bible.ts';

/** One value per colour channel; the shape the contract's OffsetRgb (lift) and MultiplierRgb (gamma, gain) share. */
export interface RgbTriple {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * The look-bible grade, exactly as schemas/look-bible.schema.json defines it
 * (the generated contract is the one source of the field set and ranges).
 * lift is the ASC CDL offset (0 neutral), gain the slope (1 neutral) and
 * gamma the power, applied as an exponent: 1 is neutral, 2 darkens the
 * midtones (0.25 becomes 0.0625) and 0.5 brightens them. contrast scales
 * around contrastPivot (0.5 for display-referred material). The spatial
 * fields (vignette, grain, halation) are read by the finishing chain, not by
 * the LUT.
 */
export type GradeParameters = Grade;

/** The grade that changes nothing. */
export const identityGrade: GradeParameters = {
  lift: { r: 0, g: 0, b: 0 },
  gamma: { r: 1, g: 1, b: 1 },
  gain: { r: 1, g: 1, b: 1 },
  saturation: 1,
  contrast: 1,
  contrastPivot: 0.5,
  splitTone: { shadowHue: 0, shadowAmount: 0, highlightHue: 0, highlightAmount: 0 },
  vignetteAmount: 0,
  vignetteSoftness: 0.5,
  grainAmount: 0,
  grainSeed: 0,
  halationAmount: 0,
};

/** Rec. 709 luma weights. */
const lumaWeights: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

const minimumGamma = 1e-6;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function luma(rgb: readonly [number, number, number]): number {
  return rgb[0] * lumaWeights[0] + rgb[1] * lumaWeights[1] + rgb[2] * lumaWeights[2];
}

/** ASC CDL for one channel: (in * slope + offset) ** power, with the base clamped at 0 so the power is defined. */
function cdl(value: number, lift: number, gamma: number, gain: number): number {
  const base = Math.max(0, value * gain + lift);
  const power = Math.max(minimumGamma, gamma);
  return power === 1 ? base : base ** power;
}

/** The pure hue at full saturation and value as RGB in 0..1 (the HSV hexcone). */
function hueToRgb(hueDegrees: number): [number, number, number] {
  const hue = (((hueDegrees % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((hue % 2) - 1);
  const sector = Math.floor(hue);
  switch (sector) {
    case 0: return [1, x, 0];
    case 1: return [x, 1, 0];
    case 2: return [0, 1, x];
    case 3: return [0, x, 1];
    case 4: return [x, 0, 1];
    default: return [1, 0, x];
  }
}

/** A hue as a zero-mean tint: the pure hue minus its channel mean, so adding it shifts colour without shifting brightness much. */
function tint(hueDegrees: number): [number, number, number] {
  const [r, g, b] = hueToRgb(hueDegrees);
  const mean = (r + g + b) / 3;
  return [r - mean, g - mean, b - mean];
}

/**
 * Applies the grade to one RGB value in 0..1, in this order: lift/gamma/gain
 * per channel, contrast around the pivot, saturation around Rec. 709 luma,
 * split tone (shadow tint weighted by how far the luma is below 0.5,
 * highlight tint by how far it is above), then a clamp to 0..1.
 */
export function applyGrade(rgb: readonly [number, number, number], grade: GradeParameters): [number, number, number] {
  let r = cdl(rgb[0], grade.lift.r, grade.gamma.r, grade.gain.r);
  let g = cdl(rgb[1], grade.lift.g, grade.gamma.g, grade.gain.g);
  let b = cdl(rgb[2], grade.lift.b, grade.gamma.b, grade.gain.b);

  const pivot = grade.contrastPivot;
  r = (r - pivot) * grade.contrast + pivot;
  g = (g - pivot) * grade.contrast + pivot;
  b = (b - pivot) * grade.contrast + pivot;

  const y = luma([r, g, b]);
  r = y + (r - y) * grade.saturation;
  g = y + (g - y) * grade.saturation;
  b = y + (b - y) * grade.saturation;

  const toneLuma = luma([r, g, b]);
  const shadowWeight = clamp01((0.5 - toneLuma) / 0.5) * grade.splitTone.shadowAmount;
  const highlightWeight = clamp01((toneLuma - 0.5) / 0.5) * grade.splitTone.highlightAmount;
  if (shadowWeight !== 0) {
    const [tr, tg, tb] = tint(grade.splitTone.shadowHue);
    r += tr * shadowWeight;
    g += tg * shadowWeight;
    b += tb * shadowWeight;
  }
  if (highlightWeight !== 0) {
    const [tr, tg, tb] = tint(grade.splitTone.highlightHue);
    r += tr * highlightWeight;
    g += tg * highlightWeight;
    b += tb * highlightWeight;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** Title line written into every .cube this module generates. */
export const cubeTitle = 'Vision.Forge grade';

/** The smallest and largest LUT sizes the .cube format and ffmpeg's lut3d accept. */
export const cubeSizeRange: { readonly min: number; readonly max: number } = { min: 2, max: 256 };

/**
 * Renders the grade as a 3D LUT in .cube format: TITLE, LUT_3D_SIZE,
 * DOMAIN_MIN, DOMAIN_MAX, then size³ lines of "r g b" with six decimals,
 * red varying fastest, blue slowest. Deterministic text; LF line endings.
 */
export function generateCube(grade: GradeParameters, size = 33): string {
  if (!Number.isInteger(size) || size < cubeSizeRange.min || size > cubeSizeRange.max) {
    throw new RangeError(`A .cube size must be an integer from ${cubeSizeRange.min} to ${cubeSizeRange.max}; got ${size}.`);
  }
  const lines: string[] = [`TITLE "${cubeTitle}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  const steps = size - 1;
  for (let bi = 0; bi < size; bi += 1) {
    for (let gi = 0; gi < size; gi += 1) {
      for (let ri = 0; ri < size; ri += 1) {
        const [r, g, b] = applyGrade([ri / steps, gi / steps, bi / steps], grade);
        lines.push(`${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
