/**
 * The look bible and a lighting rig as CSS values for the html lane: the
 * palette as custom properties, the backdrop gradient whose lit side
 * follows the key light, the box-shadow offset away from the key, and the
 * specular sheen tinted by the key's colour temperature. Pure string and
 * number functions; the lane writes the results into inline styles.
 *
 * Screen angles follow CSS: 0 degrees points up and angles grow clockwise,
 * so the cookbook's azimuth (90 = camera-right) is used as the screen angle
 * of the light directly; a light near azimuth 0 sits behind the camera and
 * is drawn as coming from the top, where its elevation puts it. CSS paints
 * a gradient's first stop at the end opposite its angle, so a gradient that
 * is lit on the key's side runs at the key's screen angle plus 180.
 */
import { parseHexColour } from '../color/contrast.ts';
import type { LookBible } from '../contracts/look-bible.ts';
import { bundledFonts } from '../typography/scale.ts';
import { dominantAzimuthDeg } from '../lighting/rigs.ts';
import type { LightingRig, RigLight } from '../lighting/rigs.ts';

/** A colour as three channels from 0 to 255. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** The six palette colours of a look, as the schema names them. */
export type Palette = LookBible['palette'];

/** The gradient stop, in percent, where the backdrop has faded to the background at a 1:1 key-to-fill ratio (the softest rig). */
export const softestGradientStopPercent = 85;

/** The gradient stop at a key-to-fill ratio of 8 or more (a hard rig). */
export const hardestGradientStopPercent = 45;

/** The key-to-fill ratio at and above which the gradient is at its hardest. */
export const hardestFillRatio = 8;

/** The opacity of the specular sheen on a stand-in. */
export const sheenOpacity = 0.35;

/** A number as CSS text with two decimals, so the same input always gives the same string. */
function fixed(value: number): string {
  return value.toFixed(2);
}

/** An angle folded into [0, 360). */
export function normaliseDegrees(degrees: number): number {
  const folded = degrees % 360;
  return folded < 0 ? folded + 360 : folded;
}

/**
 * The colour of a black body at a temperature, Tanner Helland's curve fit
 * to the CIE blackbody locus (1000 to 40000 K, within a few percent): the
 * temperature in hundreds of kelvin drives one logarithm or power per
 * channel; 6600 K is the white point where every channel saturates.
 */
export function kelvinToRgb(kelvin: number): Rgb {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const clamp = (value: number): number => Math.round(Math.min(255, Math.max(0, value)));
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return { r: clamp(r), g: clamp(g), b: clamp(b) };
}

/** The channels of a `#rrggbb` colour from 0 to 255. */
export function hexToRgb(hex: string): Rgb {
  const [r, g, b] = parseHexColour(hex);
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/** A colour as lowercase `#rrggbb`. */
export function rgbToHex(rgb: Rgb): string {
  const channel = (value: number): string => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** A `#rrggbb` colour with an alpha as CSS `rgba(r, g, b, a)`. */
export function rgbaCss(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${fixed(Math.min(1, Math.max(0, alpha)))})`;
}

/** A colour multiplied by a light's colour: the light's tint when it has one, else its black-body colour. */
export function tintByLight(hex: string, lightSource: RigLight): string {
  const base = hexToRgb(hex);
  const tint = lightSource.tint === null ? kelvinToRgb(lightSource.kelvin) : hexToRgb(lightSource.tint);
  return rgbToHex({ r: (base.r * tint.r) / 255, g: (base.g * tint.g) / 255, b: (base.b * tint.b) / 255 });
}

/** The look as CSS custom properties: the six palette colours and the two font families, as [name, value] pairs. */
export function cssVariables(look: LookBible): readonly (readonly [string, string])[] {
  const palette = look.palette;
  return [
    ['--vf-background', palette.background],
    ['--vf-surface', palette.surface],
    ['--vf-primary', palette.primary],
    ['--vf-accent', palette.accent],
    ['--vf-text', palette.text],
    ['--vf-highlight', palette.highlight],
    ['--vf-font-display', `'${bundledFonts[look.typography.display].cssFamily}'`],
    ['--vf-font-body', `'${bundledFonts[look.typography.body].cssFamily}'`],
  ];
}

/** The light the html lane draws from: the key, else the first rim, else nothing (an even gradient from the top). */
export function dominantLight(rig: LightingRig): RigLight | null {
  return rig.key ?? rig.rims[0] ?? null;
}

/** The screen angle of the light the lane draws from, in CSS degrees (0 up, clockwise): its azimuth plus the frame's key-light orbit. */
export function lightScreenAngleDeg(rig: LightingRig, keyOrbitDeg: number): number {
  return normaliseDegrees(dominantAzimuthDeg(rig) + keyOrbitDeg);
}

/** The CSS gradient angle whose first stop lands on the light's side: the light's screen angle plus 180. */
export function litGradientAngleDeg(rig: LightingRig, keyOrbitDeg: number): number {
  return normaliseDegrees(lightScreenAngleDeg(rig, keyOrbitDeg) + 180);
}

/** Where the backdrop has faded to the background, in percent of the gradient line: 85 at 1:1, 45 at 8:1 and harder, linear between. */
export function gradientStopPercent(fillRatio: number): number {
  const t = Math.min(1, Math.max(0, (fillRatio - 1) / (hardestFillRatio - 1)));
  return softestGradientStopPercent + (hardestGradientStopPercent - softestGradientStopPercent) * t;
}

/**
 * The backdrop gradient of a rig confined to a window of its gradient line:
 * the surface colour up to `startPercent`, the fade to the background over
 * the next `spanPercent` of the line (its length set by the key-to-fill
 * ratio), the background beyond. A plate larger than the frame paints the
 * fade into the slice the frame sees and lets the margins continue the end
 * colours, so a move that reveals more of the plate meets no seam.
 */
export function lightingGradientWithin(rig: LightingRig, palette: Palette, keyOrbitDeg: number, startPercent: number, spanPercent: number): string {
  const stop = startPercent + (spanPercent * gradientStopPercent(rig.fillRatio)) / 100;
  return `linear-gradient(${fixed(litGradientAngleDeg(rig, keyOrbitDeg))}deg, ${palette.surface} ${fixed(startPercent)}%, ${palette.background} ${fixed(stop)}%)`;
}

/** The backdrop gradient of a rig over a whole element: the surface colour on the lit side fading to the background, harder for a higher key-to-fill ratio. */
export function lightingGradient(rig: LightingRig, palette: Palette, keyOrbitDeg: number): string {
  return lightingGradientWithin(rig, palette, keyOrbitDeg, 0, 100);
}

/** A box-shadow offset of `px` pixels away from the light, in CSS pixels (y down). */
export function shadowOffset(rig: LightingRig, px: number, keyOrbitDeg = 0): { readonly x: number; readonly y: number } {
  const radians = (lightScreenAngleDeg(rig, keyOrbitDeg) * Math.PI) / 180;
  return { x: -Math.sin(radians) * px, y: Math.cos(radians) * px };
}

/** The gradient angle of the specular sheen: bright on the light's side, like the backdrop. */
export function sheenAngle(rig: LightingRig, keyOrbitDeg: number): number {
  return litGradientAngleDeg(rig, keyOrbitDeg);
}

/** The sheen colour: the palette highlight tinted by the light's colour temperature (or its neon tint); untinted when the rig has no light. */
export function sheenColour(rig: LightingRig, highlightHex: string): string {
  const lightSource = dominantLight(rig);
  return lightSource === null ? highlightHex : tintByLight(highlightHex, lightSource);
}

/** The sheen as a CSS gradient layer: the tinted highlight at 35 percent on the lit side, clear by 60 percent of the way across. */
export function sheenGradient(rig: LightingRig, palette: Palette, keyOrbitDeg: number): string {
  const colour = sheenColour(rig, palette.highlight);
  return `linear-gradient(${fixed(sheenAngle(rig, keyOrbitDeg))}deg, ${rgbaCss(colour, sheenOpacity)} 0%, ${rgbaCss(colour, 0)} 60%)`;
}
