/**
 * WCAG 2.2 relative luminance and contrast ratio for sRGB colours given as
 * `#rrggbb` hex, and the AA contrast minimums text must reach. Pure
 * arithmetic: runs in Node and the browser.
 */

const hexColour = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** The WCAG 2.2 AA contrast ratio body text must reach over what it sits on. */
export const bodyTextMinimumContrast = 4.5;

/** The WCAG 2.2 AA contrast ratio large text (at least 18 point, or 14 point bold) must reach over what it sits on. */
export const largeTextMinimumContrast = 3;

/** The sRGB value at or below which the transfer curve is linear (WCAG 2.2, relative luminance). */
export const srgbLinearThreshold = 0.04045;

/** One sRGB channel from 0 to 1 converted to linear light. */
function linearize(channel: number): number {
  return channel <= srgbLinearThreshold ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The three channels of a `#rrggbb` colour as fractions from 0 to 1; a RangeError names any other string. */
export function parseHexColour(hex: string): readonly [number, number, number] {
  const match = hexColour.exec(hex);
  if (match === null) throw new RangeError(`"${hex}" is not a #rrggbb colour.`);
  const channel = (index: number): number => Number.parseInt(match[index] ?? '00', 16) / 255;
  return [channel(1), channel(2), channel(3)];
}

/** Relative luminance of a `#rrggbb` colour from 0 (black) to 1 (white), per WCAG 2.2 with the 0.04045 threshold. */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = parseHexColour(hex);
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

/** WCAG 2.2 contrast ratio between two relative luminances (0 to 1 each), from 1 (identical) to 21 (black against white); the order of the arguments does not matter. */
export function contrastRatioOfLuminances(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.2 contrast ratio between two `#rrggbb` colours, from 1 (identical) to 21 (black on white); the order of the arguments does not matter. */
export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  return contrastRatioOfLuminances(relativeLuminance(foregroundHex), relativeLuminance(backgroundHex));
}
