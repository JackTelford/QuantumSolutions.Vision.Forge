/** @generated from schemas/look-bible.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Named look the look bible starts from; custom means every value was set by hand.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "LookPreset".
 */
export type LookPreset =
  | 'studio-clean'
  | 'obsidian'
  | 'warm-editorial'
  | 'neon-tech'
  | 'paper-flat'
  | 'noir-title'
  | 'sunset-gradient'
  | 'custom';
/**
 * One of the bundled OFL font families.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "FontFamily".
 */
export type FontFamily = 'inter' | 'space-grotesk' | 'playfair-display' | 'jetbrains-mono';
/**
 * Lighting setup from the lighting cookbook; every lane maps it to its own lights and calibrated intensities.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "LightingPreset".
 */
export type LightingPreset =
  | 'product-studio'
  | 'three-point-soft'
  | 'rembrandt'
  | 'butterfly'
  | 'split'
  | 'rim-only'
  | 'contre-jour'
  | 'window'
  | 'soft-cross'
  | 'high-key'
  | 'low-key'
  | 'golden-hour'
  | 'overcast-soft'
  | 'neon-night'
  | 'practical-glow'
  | 'neon-rim';
/**
 * The family of easing and timing defaults a look uses for every move and animation.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "MotionFamily".
 */
export type MotionFamily = 'calm' | 'snappy' | 'cinematic';
/**
 * Tone mapping of the 3D lanes (ADR 0008): agx for photographic looks, standard for graphic looks.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "ToneMapping".
 */
export type ToneMapping = 'agx' | 'standard';

/**
 * The one look every shot of a piece shares (ADR 0008): palette, typography, default lighting, motion family, tone mapping, exposure, the finishing grade and the exposure band QA holds frames to. The finishing module turns the grade into a .cube LUT and an ffmpeg filter chain.
 */
export interface LookBible {
  /**
   * Document kind; always "look-bible".
   */
  kind: 'look-bible';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * Slug that names the look, 2 to 63 lowercase letters, digits and hyphens, for example "obsidian". Treatments and shot specs refer to it as lookId.
   */
  id: string;
  /**
   * Display name of the look, for example "Obsidian".
   */
  name: string;
  preset: LookPreset;
  /**
   * The six colours of the look as lowercase sRGB hex; text must reach WCAG contrast 4.5 over background and over surface.
   */
  palette: {
    /**
     * Frame background colour as lowercase hex, for example "#0b0b0f".
     */
    background: string;
    /**
     * Colour of cards, panels and lower-third plates as lowercase hex, for example "#16161d".
     */
    surface: string;
    /**
     * Brand or subject colour as lowercase hex, for example "#c9a84c".
     */
    primary: string;
    /**
     * Secondary colour for emphasis as lowercase hex, for example "#4cc9c0".
     */
    accent: string;
    /**
     * Text colour as lowercase hex, for example "#f4f1ea".
     */
    text: string;
    /**
     * Colour of speculars, rims and glow as lowercase hex, for example "#ffffff".
     */
    highlight: string;
  };
  /**
   * The type system of the look: two bundled families and the scale between roles.
   */
  typography: {
    display: FontFamily;
    body: FontFamily;
    /**
     * Ratio between successive sizes of the type scale: 1.25 (major third) or 1.333 (perfect fourth).
     */
    scaleRatio: number;
    /**
     * Letter spacing of display text in em, for example -0.02 (tighter) or 0.
     */
    displayTrackingEm: number;
    /**
     * Letter spacing of uppercase labels in em, for example 0.08.
     */
    uppercaseTrackingEm: number;
  };
  lightingDefault: LightingPreset;
  motionFamily: MotionFamily;
  toneMapping: ToneMapping;
  /**
   * Base exposure of every shot in EV stops relative to the calibrated gray card, for example -0.3; each shot adds its exposureOffsetEv.
   */
  exposureEv: number;
  grade: Grade;
  /**
   * The band QA holds the picture to.
   */
  qa: {
    /**
     * Lowest acceptable average luma per frame as ffmpeg signalstats YAVG reports it, 0 to 255, for example 24.
     */
    yavgMin: number;
    /**
     * Highest acceptable average luma per frame as ffmpeg signalstats YAVG reports it, 0 to 255 and above yavgMin, for example 140.
     */
    yavgMax: number;
  };
  /**
   * When the look bible was written: an RFC 3339 timestamp in UTC with millisecond precision, for example 2026-10-26T20:00:00.000Z.
   */
  createdAt: string;
}
/**
 * The finishing grade (ADR 0008): lift, gamma and gain, saturation and contrast, split toning, vignette, grain and halation. src/shared/grade/ bakes it into a 33-point .cube LUT; the vignette and the grain are ffmpeg filters applied at assembly.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "Grade".
 */
export interface Grade {
  lift: OffsetRgb;
  gamma: MultiplierRgb;
  gain: MultiplierRgb;
  /**
   * Saturation multiplier from 0 (monochrome) to 2 (double); 1 changes nothing, for example 0.9.
   */
  saturation: number;
  /**
   * Contrast multiplier around the pivot from 0 (flat) to 2 (double); 1 changes nothing, for example 1.1.
   */
  contrast: number;
  /**
   * The picture level the contrast pivots on, 0 to 1 of the display range, for example 0.18 for middle gray.
   */
  contrastPivot: number;
  splitTone: SplitTone;
  /**
   * Vignette strength from 0 (none) to 1 (strong), for example 0.25.
   */
  vignetteAmount: number;
  /**
   * Vignette falloff from 0 (hard) to 1 (soft), for example 0.6.
   */
  vignetteSoftness: number;
  /**
   * Grain strength from 0 (none) to 1 (heavy), for example 0.15; applied only at assembly, never on stills.
   */
  grainAmount: number;
  /**
   * Seed of the grain noise, for example 7; the same seed reproduces the same grain.
   */
  grainSeed: number;
  /**
   * Halation (glow bleeding from bright edges) from 0 (none) to 1 (strong), for example 0.1.
   */
  halationAmount: number;
}
/**
 * A per-channel offset added to the picture, each channel -1 to 1 where 0 changes nothing.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "OffsetRgb".
 */
export interface OffsetRgb {
  /**
   * Red offset, -1 to 1, for example 0.02.
   */
  r: number;
  /**
   * Green offset, -1 to 1, for example 0.
   */
  g: number;
  /**
   * Blue offset, -1 to 1, for example -0.01.
   */
  b: number;
}
/**
 * A per-channel multiplier (gain) or exponent (gamma) applied to the picture, each channel 0 to 4 where 1 changes nothing; as an exponent, a value above 1 darkens the midtones and a value below 1 brightens them.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "MultiplierRgb".
 */
export interface MultiplierRgb {
  /**
   * Red factor, 0 to 4, for example 1.05.
   */
  r: number;
  /**
   * Green factor, 0 to 4, for example 1.
   */
  g: number;
  /**
   * Blue factor, 0 to 4, for example 0.98.
   */
  b: number;
}
/**
 * A hue tint applied to shadows and another to highlights.
 *
 * This interface was referenced by `LookBible`'s JSON-Schema
 * via the `definition` "SplitTone".
 */
export interface SplitTone {
  /**
   * Hue of the shadow tint in degrees, 0 to 360, for example 220 for blue.
   */
  shadowHue: number;
  /**
   * Strength of the shadow tint from 0 (none) to 1 (full), for example 0.15.
   */
  shadowAmount: number;
  /**
   * Hue of the highlight tint in degrees, 0 to 360, for example 40 for amber.
   */
  highlightHue: number;
  /**
   * Strength of the highlight tint from 0 (none) to 1 (full), for example 0.1.
   */
  highlightAmount: number;
}

/** Every LookPreset value the schema allows, in schema order. */
export const LookPresetValues = ['studio-clean', 'obsidian', 'warm-editorial', 'neon-tech', 'paper-flat', 'noir-title', 'sunset-gradient', 'custom'] as const;

/** Every FontFamily value the schema allows, in schema order. */
export const FontFamilyValues = ['inter', 'space-grotesk', 'playfair-display', 'jetbrains-mono'] as const;

/** Every LightingPreset value the schema allows, in schema order. */
export const LightingPresetValues = ['product-studio', 'three-point-soft', 'rembrandt', 'butterfly', 'split', 'rim-only', 'contre-jour', 'window', 'soft-cross', 'high-key', 'low-key', 'golden-hour', 'overcast-soft', 'neon-night', 'practical-glow', 'neon-rim'] as const;

/** Every MotionFamily value the schema allows, in schema order. */
export const MotionFamilyValues = ['calm', 'snappy', 'cinematic'] as const;

/** Every ToneMapping value the schema allows, in schema order. */
export const ToneMappingValues = ['agx', 'standard'] as const;
