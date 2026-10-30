/**
 * The finishing of a delivery (ADR 0008): per clip, the 3D LUT in 16-bit
 * RGB and the vignette (src/assemble/plate.ts lays the clip's text plate
 * over the graded picture); after the clips are joined, seeded grain, then
 * the one RGB-to-YUV conversion with an explicit BT.709 matrix and limited
 * range, and the pixel format the codec needs. The join stays in 16-bit
 * RGB unless a vignette or a text plate makes it 8-bit (joinFormat), so a
 * plan without either takes the same path as before the per-clip grade.
 * The same grade finishes every lane's frames at assembly and the still
 * (src/render/finish-still.ts).
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
  // threads=1 keeps the noise filter on one thread: ffmpeg 7.0 slices it
  // across threads in an order that varies run to run, so the same seed gave
  // different grain on a second encode; 9.0 is reproducible either way.
  return `noise=all_seed=${Math.max(0, Math.floor(seed))}:all_strength=${strength}:all_flags=t+u:threads=1`;
}

/** 8-bit planar RGB: what a text plate is laid on, what the grain filter takes, and the format a vignetted clip is already in. */
export const eightBitFormat = 'format=gbrp';

/** 16-bit planar RGB: the format the LUT works in and the join keeps when nothing in the chain is 8-bit by nature. */
export const sixteenBitFormat = 'format=gbrp16le';

/**
 * The pixel format every clip ends in before the join (src/assemble/plate.ts),
 * the same for every clip so concat and xfade see identical streams. It is
 * 16-bit planar RGB, the path ADR 0008 decision 3 measured and the one a
 * prores master is fed from, unless something in the chain is 8-bit by
 * nature: a vignette (ffmpeg 9's vignette outputs rgb24) or a text plate
 * anywhere in the plan (the overlay works in 8-bit rgba). Then the join is
 * 8-bit planar RGB, as the old single chain already was for those grades.
 */
export function joinFormat(grade: FinishingGrade | undefined, anyTextPlate: boolean): string {
  const vignetted = grade !== undefined && vignetteFilter(grade.vignetteAmount) !== undefined;
  return anyTextPlate || vignetted ? eightBitFormat : sixteenBitFormat;
}

/**
 * The grade of one clip (ADR 0008 decision 4: picture plates are graded,
 * text plates are laid over them afterwards): `format=gbrp16le` first, with
 * or without a grade, then `lut3d` (tetrahedral) when the grade has a cube,
 * then `format=rgb24` and the vignette when its amount is above 0. The
 * caller ends the chain in joinFormat.
 *
 * Every clip enters 16-bit RGB first because swscale's 8-bit and 16-bit
 * YUV-to-RGB paths do not agree (about 32 dB PSNR apart on testsrc2), so a
 * graded clip and a bare one would otherwise differ by more than the
 * grade; the 16-bit path is also the one every calibration number of ADR
 * 0008 was measured through.
 */
export function clipGradeFilters(grade: FinishingGrade | undefined): readonly string[] {
  const steps: string[] = [sixteenBitFormat];
  if (grade === undefined) return steps;
  if (grade.cubePath !== null) steps.push(`lut3d=file=${filterPath(grade.cubePath)}:interp=tetrahedral`);
  const vignette = vignetteFilter(grade.vignetteAmount);
  if (vignette !== undefined) steps.push('format=rgb24', vignette);
  return steps;
}

/**
 * The steps after the clips are joined, in order: `format=gbrp` and the
 * seeded grain when its strength is above 0 (noise takes 8-bit planar RGB;
 * on a join already in it the format step is a pass-through; the grain
 * lands on the text plates too, as film grain does), then the BT.709
 * limited-range conversion and the codec's pixel format. Without grain the
 * tail is the conversion alone, from whatever depth the join kept.
 */
export function deliveryTailFilters(grade: FinishingGrade | undefined, codec: Codec): readonly string[] {
  const grain = grade === undefined ? undefined : grainFilter(grade.grainAmount, grade.grainSeed);
  return [...(grain === undefined ? [] : [eightBitFormat, grain]), bt709Scale, `format=${codecPixelFormat[codec]}`];
}

/** The container-level colour tags every delivery carries: BT.709 primaries, transfer and matrix, limited range. */
export function colorTagArguments(): readonly string[] {
  return ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
}
