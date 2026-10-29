/**
 * The sRGB transfer function in the decoding direction (IEC 61966-2-1):
 * a display value from 0 to 1 to linear light. The look bible's palette
 * is sRGB hex; Blender's colour sockets take linear light, so the blender
 * lane converts every palette colour and every balanced light colour
 * here. The encoding direction lives in calibration/scene.ts
 * (linearToSrgbChannel); contrast.ts keeps its own private copy of this
 * decode because WCAG names the same curve. Pure arithmetic: runs in Node
 * and the browser.
 */
import { parseHexColour } from './contrast.ts';

/** A colour in linear light, each channel 0 to 1, as Blender's colour sockets take it. */
export interface LinearRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** The sRGB display value at or below which the decoding curve is the straight line value / 12.92. */
export const srgbDecodeLinearSegmentLimit = 0.04045;

/** One sRGB channel from 0 to 1 as linear light: value / 12.92 on the linear segment, else ((value + 0.055) / 1.055)^2.4. */
export function srgbToLinear(channel: number): number {
  if (channel <= srgbDecodeLinearSegmentLimit) return channel / 12.92;
  return ((channel + 0.055) / 1.055) ** 2.4;
}

/** A `#rrggbb` colour as linear light. */
export function hexToLinearRgb(hex: string): LinearRgb {
  const [red, green, blue] = parseHexColour(hex);
  return { r: srgbToLinear(red), g: srgbToLinear(green), b: srgbToLinear(blue) };
}

/** A colour given as sRGB channels from 0 to 255 (css-tokens.ts Rgb) as linear light. */
export function rgb255ToLinear(rgb: { readonly r: number; readonly g: number; readonly b: number }): LinearRgb {
  return { r: srgbToLinear(rgb.r / 255), g: srgbToLinear(rgb.g / 255), b: srgbToLinear(rgb.b / 255) };
}

/** A neutral colour of the given linear reflectance (0 to 1) in every channel. */
export function neutralLinearRgb(reflectance: number): LinearRgb {
  return { r: reflectance, g: reflectance, b: reflectance };
}
