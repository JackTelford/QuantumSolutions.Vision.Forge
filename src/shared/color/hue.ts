/**
 * The hue of an sRGB colour and the shortest angle between two hues, for
 * the calibration report of ADR 0008 decision 2: a lane's saturated swatch
 * is judged by how far its hue turned, not by its luma, because AgX
 * desaturates and shifts saturated colours on purpose. Pure arithmetic on
 * the gamma-encoded channels (the hue of a display colour as a viewer sees
 * it); runs in Node and the browser.
 */
import { parseHexColour } from './contrast.ts';

/** An sRGB colour as channels from 0 to 255. */
export interface Rgb255 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * The hue of a colour in degrees from 0 (red) through 120 (green) and 240
 * (blue), as the HSV hexcone defines it; 0 for a gray, which has no hue.
 */
export function hueDegrees(rgb: Rgb255): number {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const chroma = max - min;
  if (chroma === 0) return 0;
  let sector: number;
  if (max === rgb.r) sector = ((rgb.g - rgb.b) / chroma) % 6;
  else if (max === rgb.g) sector = (rgb.b - rgb.r) / chroma + 2;
  else sector = (rgb.r - rgb.g) / chroma + 4;
  const degrees = sector * 60;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** The HSV saturation of a colour from 0 (gray) to 1 (a pure hue); 0 for black. */
export function saturation(rgb: Rgb255): number {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  if (max === 0) return 0;
  return (max - Math.min(rgb.r, rgb.g, rgb.b)) / max;
}

/** The shortest signed turn from one hue to another, in degrees from -180 to 180: positive when `to` lies counter-clockwise (red toward green) of `from`. */
export function hueDeltaDegrees(fromDeg: number, toDeg: number): number {
  const turn = (((toDeg - fromDeg) % 360) + 540) % 360 - 180;
  // The modulo above maps a half turn to -180; the report prefers the positive name for it.
  return turn === -180 ? 180 : turn;
}

/** The channels of a `#rrggbb` colour as 0 to 255. */
export function hexToRgb255(hex: string): Rgb255 {
  const [red, green, blue] = parseHexColour(hex);
  return { r: Math.round(red * 255), g: Math.round(green * 255), b: Math.round(blue * 255) };
}
