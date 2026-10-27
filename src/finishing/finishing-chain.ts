/**
 * The end of the video filter chain (ADR 0008): the 3D LUT in 16-bit RGB,
 * the vignette, seeded grain, then the one RGB-to-YUV conversion with an
 * explicit BT.709 matrix and limited range, and the pixel format the codec
 * needs. The same chain finishes every lane's frames at assembly.
 *
 * Every pixel-format step is explicit because ffmpeg otherwise inserts its
 * own conversions with an unknown matrix and range: on ffmpeg 9 the vignette
 * filter accepts rgb24 but not gbrp16le, and noise accepts gbrp but no 10-bit
 * format. Keeping the chain in RGB until the explicit `scale` means the
 * BT.709 matrix is applied exactly once, to full-range RGB.
 */
import type { Codec, FinishingGrade } from '../shared/contracts/assembly-plan.ts';
import { filterPath } from '../tools/ffmpeg.ts';

/** Pixel format each codec is fed. */
export const codecPixelFormat: Readonly<Record<Codec, string>> = { h264: 'yuv420p', hevc: 'yuv420p', prores: 'yuv422p10le' };

/** The RGB-to-YUV conversion: full-range RGB in, limited-range BT.709 out. */
export const bt709Scale = 'scale=in_range=full:out_range=tv:out_color_matrix=bt709';

/** Noise strength ffmpeg receives for grainAmount 1 (its scale is 0..100). */
export const grainStrengthScale = 40;

/** The vignette's lens half-angle divisors: amounts just above 0 approach PI/12 (barely visible); 0 omits the filter; 1 maps to PI/4 (the strongest the filter draws). */
export const vignetteAngleDivisors: { readonly weakest: number; readonly strongest: number } = { weakest: 12, strongest: 4 };

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The ffmpeg vignette filter for an amount in 0..1, or undefined for 0.
 * ffmpeg's `vignette` takes a lens angle: PI/5 by default, larger is
 * darker. The amount is mapped linearly onto the divisor, 12 down to 4, so
 * 0.25 gives PI/10, 0.5 gives PI/8 and 1 gives PI/4. The divisor keeps two
 * decimals. Softness has no counterpart in the filter (its falloff is fixed)
 * and is ignored here.
 */
export function vignetteFilter(amount: number): string | undefined {
  const clamped = clamp01(amount);
  if (clamped === 0) return undefined;
  const divisor = vignetteAngleDivisors.weakest - (vignetteAngleDivisors.weakest - vignetteAngleDivisors.strongest) * clamped;
  const text = divisor.toFixed(2).replace(/\.?0+$/, '');
  return `vignette=angle=PI/${text}`;
}

/** The seeded grain filter: strength round(amount * 40) on every plane, temporal and uniform; undefined when the strength rounds to 0. */
export function grainFilter(amount: number, seed: number): string | undefined {
  const strength = Math.min(100, Math.round(clamp01(amount) * grainStrengthScale));
  if (strength === 0) return undefined;
  return `noise=all_seed=${Math.max(0, Math.floor(seed))}:all_strength=${strength}:all_flags=t+u`;
}

/**
 * The per-frame finishing steps, in order: `format=gbrp16le`; with a grade,
 * `lut3d` (tetrahedral) when it has a cube, then `format=rgb24` and the
 * vignette when the amount is above 0, then `format=gbrp` and the grain when
 * the strength is above 0; then the BT.709 limited-range conversion and the
 * codec's pixel format. Without a grade the chain is the conversion alone,
 * still through 16-bit RGB so the matrix is applied to RGB.
 */
export function finishingFilters(grade: FinishingGrade | undefined, codec: Codec): readonly string[] {
  const steps: string[] = ['format=gbrp16le'];
  if (grade !== undefined) {
    if (grade.cubePath !== null) steps.push(`lut3d=file=${filterPath(grade.cubePath)}:interp=tetrahedral`);
    const vignette = vignetteFilter(grade.vignetteAmount);
    if (vignette !== undefined) steps.push('format=rgb24', vignette);
    const grain = grainFilter(grade.grainAmount, grade.grainSeed);
    if (grain !== undefined) steps.push('format=gbrp', grain);
  }
  steps.push(bt709Scale, `format=${codecPixelFormat[codec]}`);
  return steps;
}

/** The container-level colour tags every delivery carries: BT.709 primaries, transfer and matrix, limited range. */
export function colorTagArguments(): readonly string[] {
  return ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
}
