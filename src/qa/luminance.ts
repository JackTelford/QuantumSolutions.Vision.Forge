/**
 * Relative luminance and WCAG contrast for the text-contrast check.
 *
 * Two inputs meet here. A text colour arrives as sRGB hex and goes through
 * the shared WCAG 2.2 implementation in src/shared/color/contrast.ts, the
 * same one the look-bible check uses. A background arrives as ffmpeg
 * signalstats' limited-range luma average (YAVG, 16 black to 235 white): it
 * is mapped to a nominal 0 to 1 value and linearized with a plain 2.2 power
 * curve, the BT.1886 display transfer, which stays within about 0.01 of the
 * sRGB curve through the mid-tones. The check's 4.5:1 threshold is coarse
 * enough that the approximation does not change verdicts. Chroma is ignored
 * on both sides, as WCAG does.
 */
import { contrastRatioOfLuminances, relativeLuminance } from '../shared/color/contrast.ts';

/** True for a six-digit hex colour such as "#1a2B3c". */
export function isHexColor(text: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(text);
}

/** WCAG relative luminance (0 black to 1 white) of a "#rrggbb" colour; NaN when the text is not one. */
export function relativeLuminanceOfHex(hex: string): number {
  return isHexColor(hex) ? relativeLuminance(hex) : Number.NaN;
}

/** Relative luminance (0 to 1) of a limited-range luma average: (YAVG - 16) / 219 clamped to 0..1, then raised to 2.2. */
export function relativeLuminanceOfLuma(yavg: number): number {
  const nominal = Math.min(1, Math.max(0, (yavg - 16) / 219));
  return nominal ** 2.2;
}

/** WCAG contrast ratio (1 to 21) between two relative luminances, in either order. */
export function contrastRatio(a: number, b: number): number {
  return contrastRatioOfLuminances(a, b);
}
