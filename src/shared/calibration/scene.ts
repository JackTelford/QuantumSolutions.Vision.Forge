/**
 * The calibration scene of ADR 0008 as data: every lane renders it in M4
 * and the measured YAVG of each patch, against the expected value here,
 * sets that lane's light-intensity scalar. Positions are fractions of the
 * frame (0 at the left or top, 1 at the right or bottom) on a 16:9 frame;
 * colours are sRGB `#rrggbb`. Pure arithmetic: runs in Node and the browser.
 *
 * Reflectance to sRGB: a surface of linear reflectance L shows the sRGB
 * channel value 1.055 × L^(1/2.4) − 0.055 (12.92 × L below 0.0031308), per
 * IEC 61966-2-1. The 18 percent gray card is therefore not `#777777`
 * (119 / 255 = 0.4667): 0.18 → 0.4614 → 0.4614 × 255 = 117.7 → 118 →
 * `#767676`. Likewise 0.90 → 0.9547 → 243 → `#f3f3f3` and 0.02 → 0.1517 →
 * 39 → `#272727`.
 *
 * Expected YAVG: ffmpeg's signalstats reads the Y' plane of the limited-
 * range BT.709 yuv420p output that the finishing chain produces
 * (`out_color_matrix=bt709:out_range=tv`), and that plane is formed from
 * the gamma-encoded channels R', G', B' (the sRGB values, 0 to 1), not from
 * linear light: Y' = 16 + 219 × (0.2126 R' + 0.7152 G' + 0.0722 B'). The
 * gray card at `#767676` gives 16 + 219 × 118 / 255 = 117.3; applying the
 * coefficients to the linear reflectance instead would predict 55, which
 * no lane measures.
 */
import { parseHexColour } from '../color/contrast.ts';

/** The BT.709 luma coefficients applied to the gamma-encoded channels (non-constant luminance, as yuv420p stores it). */
export const bt709Luma: { readonly red: number; readonly green: number; readonly blue: number } = { red: 0.2126, green: 0.7152, blue: 0.0722 };

/** Limited-range (TV) luma: black sits at 16 and white at 235, a span of 219 code values. */
export const limitedRangeBlack = 16;
/** The span from limited-range black (16) to white (235). */
export const limitedRangeSpan = 219;

/** The linear value at or below which the sRGB transfer curve is the straight line 12.92 × L (IEC 61966-2-1). */
export const srgbLinearSegmentLimit = 0.0031308;

/** A box in the frame: left, top, width and height as fractions of the frame (x and w of the width, y and h of the height), like every other box in the repository. */
export interface FrameBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A flat patch of one colour: a gray card, the white and black patches and the saturated swatches. */
export interface CalibrationPatch {
  readonly kind: 'patch';
  readonly id: string;
  /** The sRGB colour of the patch. */
  readonly hex: string;
  /** Linear reflectance from 0 to 1 for the neutral patches; null for the swatches, which are defined by their sRGB value. */
  readonly linearReflectance: number | null;
  readonly box: FrameBox;
  /** The limited-range YAVG the finished frame should measure inside the box. */
  readonly expectedYavg: number;
  /** How far the measured YAVG may stray from the expectation, in code values. */
  readonly tolerance: number;
}

/** A sphere lit by the rig: the glossy one reports the highlight, the matte one the shading falloff; neither is measured for luma. */
export interface CalibrationSphere {
  readonly kind: 'sphere';
  readonly id: string;
  /** The sRGB base colour of the sphere's material. */
  readonly hex: string;
  /** Material roughness from 0 (mirror) to 1 (chalk). */
  readonly roughness: number;
  /** The bounding box of the sphere's silhouette on a 16:9 frame; h is the diameter as a fraction of the height. */
  readonly box: FrameBox;
  readonly expectedYavg: null;
  readonly tolerance: null;
}

/** A line of text that checks every lane renders type at the same size and weight; it is measured for legibility, not luma. */
export interface CalibrationText {
  readonly kind: 'text';
  readonly id: string;
  readonly hex: string;
  /** The text shown, verbatim. */
  readonly content: string;
  /** Glyph height in pixels at the reference frame size. */
  readonly sizePx: number;
  readonly box: FrameBox;
  readonly expectedYavg: null;
  readonly tolerance: null;
}

/** One element of the calibration scene. */
export type CalibrationElement = CalibrationPatch | CalibrationSphere | CalibrationText;

/** The whole scene: the reference frame size, the background and the elements. */
export interface CalibrationScene {
  /** The frame the pixel sizes refer to; fractions scale to any 16:9 frame. */
  readonly referenceWidthPx: number;
  readonly referenceHeightPx: number;
  /** The background behind every element. */
  readonly background: { readonly hex: string; readonly linearReflectance: number };
  readonly elements: readonly CalibrationElement[];
}

/** The sRGB encoding of one linear channel value from 0 to 1 (IEC 61966-2-1): 12.92 × L on the linear segment, else 1.055 × L^(1/2.4) − 0.055. */
export function linearToSrgbChannel(linear: number): number {
  if (linear <= srgbLinearSegmentLimit) return 12.92 * linear;
  return 1.055 * linear ** (1 / 2.4) - 0.055;
}

/** The `#rrggbb` of a neutral surface of the given linear reflectance (0 to 1): the sRGB channel scaled to 0..255 and rounded to the nearest code. */
export function linearReflectanceToHex(reflectance: number): string {
  if (!(reflectance >= 0 && reflectance <= 1)) throw new RangeError(`Reflectance must lie between 0 and 1, not ${reflectance}.`);
  const code = Math.round(linearToSrgbChannel(reflectance) * 255);
  const pair = code.toString(16).padStart(2, '0');
  return `#${pair}${pair}${pair}`;
}

/** The limited-range YAVG of a flat `#rrggbb` colour: 16 + 219 × (0.2126 R' + 0.7152 G' + 0.0722 B') on the gamma-encoded channels (0 to 1). */
export function expectedYavg(hex: string): number {
  const [red, green, blue] = parseHexColour(hex);
  const luma = bt709Luma.red * red + bt709Luma.green * green + bt709Luma.blue * blue;
  return limitedRangeBlack + limitedRangeSpan * luma;
}

/** The YAVG tolerance of the gray card, the one patch that gates the per-lane scalar: ±5 per ADR 0008. */
export const neutralYavgTolerance = 5;

/**
 * The YAVG tolerance of the saturated swatches and of the white and black
 * patches: wider, because the AgX lanes set their scalar on the gray card
 * and then roll off scene-linear 0.9 and lift 0.02, and compress saturated
 * colours (ADR 0008); M4 may tighten it.
 */
export const swatchYavgTolerance = 10;

/** The six swatches: sRGB primaries and secondaries at 80 percent of the channel (0.8 × 255 = 204 = `cc`). */
const swatchHexes = { red: '#cc0000', green: '#00cc00', blue: '#0000cc', cyan: '#00cccc', magenta: '#cc00cc', yellow: '#cccc00' } as const;

/**
 * The calibration scene; every box is left, top, width, height. Row one
 * (top 0.07): the glossy and matte spheres. Row two (tops 0.30 to 0.34):
 * the 90 percent white patch, the 18 percent gray card and the 2 percent
 * black patch. Row three (top 0.71): the six swatches in spectral order.
 * Bottom (top 0.8978): a 48 px text line inside title safe. Expected YAVG
 * values are `expectedYavg(hex)` rounded to a tenth.
 *
 * Only gray-18 gates the per-lane light scalar (±5, ADR 0008). The other
 * patches are reported, not gated: white-90 and black-2 show the highlight
 * roll-off and the toe of the lane's view transform, the swatches its
 * handling of saturated colour, and all of them carry the wider tolerance.
 */
export const calibrationScene = {
  referenceWidthPx: 1920,
  referenceHeightPx: 1080,
  background: { hex: '#595959', linearReflectance: 0.1 },
  elements: [
    { kind: 'sphere', id: 'sphere-glossy', hex: '#767676', roughness: 0.15, box: { x: 0.29375, y: 0.07, w: 0.1125, h: 0.2 }, expectedYavg: null, tolerance: null },
    { kind: 'sphere', id: 'sphere-matte', hex: '#767676', roughness: 0.85, box: { x: 0.59375, y: 0.07, w: 0.1125, h: 0.2 }, expectedYavg: null, tolerance: null },
    { kind: 'patch', id: 'white-90', hex: '#f3f3f3', linearReflectance: 0.9, box: { x: 0.13, y: 0.34, w: 0.14, h: 0.22 }, expectedYavg: 224.7, tolerance: swatchYavgTolerance },
    { kind: 'patch', id: 'gray-18', hex: '#767676', linearReflectance: 0.18, box: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, expectedYavg: 117.3, tolerance: neutralYavgTolerance },
    { kind: 'patch', id: 'black-2', hex: '#272727', linearReflectance: 0.02, box: { x: 0.73, y: 0.34, w: 0.14, h: 0.22 }, expectedYavg: 49.5, tolerance: swatchYavgTolerance },
    { kind: 'patch', id: 'swatch-red', hex: swatchHexes.red, linearReflectance: null, box: { x: 0.1, y: 0.71, w: 0.1, h: 0.14 }, expectedYavg: 53.2, tolerance: swatchYavgTolerance },
    { kind: 'patch', id: 'swatch-yellow', hex: swatchHexes.yellow, linearReflectance: null, box: { x: 0.24, y: 0.71, w: 0.1, h: 0.14 }, expectedYavg: 178.6, tolerance: swatchYavgTolerance },
    { kind: 'patch', id: 'swatch-green', hex: swatchHexes.green, linearReflectance: null, box: { x: 0.38, y: 0.71, w: 0.1, h: 0.14 }, expectedYavg: 141.3, tolerance: swatchYavgTolerance },
    { kind: 'patch', id: 'swatch-cyan', hex: swatchHexes.cyan, linearReflectance: null, box: { x: 0.52, y: 0.71, w: 0.1, h: 0.14 }, expectedYavg: 154.0, tolerance: swatchYavgTolerance },
    { kind: 'patch', id: 'swatch-blue', hex: swatchHexes.blue, linearReflectance: null, box: { x: 0.66, y: 0.71, w: 0.1, h: 0.14 }, expectedYavg: 28.6, tolerance: swatchYavgTolerance },
    { kind: 'patch', id: 'swatch-magenta', hex: swatchHexes.magenta, linearReflectance: null, box: { x: 0.8, y: 0.71, w: 0.1, h: 0.14 }, expectedYavg: 65.9, tolerance: swatchYavgTolerance },
    { kind: 'text', id: 'text-48', hex: '#f3f3f3', content: 'Calibration 48 px Inter 400', sizePx: 48, box: { x: 0.3, y: 0.8978, w: 0.4, h: 0.0444 }, expectedYavg: null, tolerance: null },
  ],
} as const satisfies CalibrationScene;
