/**
 * The seven looks of references/color/look-bible.md as look-bible
 * documents, one per LookPreset other than custom: the table's palette,
 * type, lighting, motion, tone map, grade and QA band as numbers. The
 * table describes each grade in words ("warm gain", "cool shadows"); the
 * numbers here are the first reading of those words and are judged on the
 * lookdev sheet (docs/evidence/m4/), not assumed. Every preset validates
 * against the look-bible schema and its text clears 4.5:1 over the
 * background and the surface (tests/shared/look/presets.test.ts).
 */
import type { Grade, LookBible, LookPreset } from '../contracts/look-bible.ts';

/** The presets a look bible can be built from: every LookPreset but custom. */
export type NamedLookPreset = Exclude<LookPreset, 'custom'>;

/** The timestamp every preset carries: the day the presets were written, so the documents are byte-stable. */
export const presetsCreatedAt = '2026-10-29T00:00:00.000Z';

/** A grade that changes nothing: the paper-flat grade, and the base every other grade is written over. */
export const neutralGrade: Grade = {
  lift: { r: 0, g: 0, b: 0 },
  gamma: { r: 1, g: 1, b: 1 },
  gain: { r: 1, g: 1, b: 1 },
  saturation: 1,
  contrast: 1,
  contrastPivot: 0.5,
  splitTone: { shadowHue: 0, shadowAmount: 0, highlightHue: 0, highlightAmount: 0 },
  vignetteAmount: 0,
  vignetteSoftness: 0.6,
  grainAmount: 0,
  grainSeed: 7,
  halationAmount: 0,
};

/** The two tracking values every look shares: display type a touch tight, uppercase labels spaced. */
const tracking = { displayTrackingEm: -0.02, uppercaseTrackingEm: 0.08 } as const;

/** The fields every preset shares. */
const common = { kind: 'look-bible', version: 1, createdAt: presetsCreatedAt } as const;

/** The seven looks. */
export const lookPresets: Readonly<Record<NamedLookPreset, LookBible>> = {
  'studio-clean': {
    ...common,
    id: 'studio-clean',
    name: 'Studio Clean',
    preset: 'studio-clean',
    palette: { background: '#f4f4f2', surface: '#ffffff', primary: '#1a1a1a', accent: '#2a6df4', text: '#1a1a1a', highlight: '#ffffff' },
    typography: { display: 'inter', body: 'inter', scaleRatio: 1.25, ...tracking },
    lightingDefault: 'product-studio',
    motionFamily: 'calm',
    toneMapping: 'standard',
    exposureEv: 0,
    grade: { ...neutralGrade, contrast: 1.02, vignetteAmount: 0.08 },
    qa: { yavgMin: 170, yavgMax: 200 },
  },
  obsidian: {
    ...common,
    id: 'obsidian',
    name: 'Obsidian',
    preset: 'obsidian',
    palette: { background: '#0b0b0d', surface: '#15161a', primary: '#e8e4dc', accent: '#c9a24a', text: '#f2efe8', highlight: '#ffffff' },
    typography: { display: 'space-grotesk', body: 'inter', scaleRatio: 1.333, ...tracking },
    lightingDefault: 'low-key',
    motionFamily: 'cinematic',
    toneMapping: 'agx',
    // A dark look sits a third of a stop under the calibrated card; the QA band (30 to 60) says so.
    exposureEv: -0.3,
    // "warm lift +0.02 r, cool gain": the shadows lifted on red, the gain a touch blue.
    grade: { ...neutralGrade, lift: { r: 0.02, g: 0, b: 0 }, gain: { r: 0.98, g: 1, b: 1.03 }, saturation: 0.95, vignetteAmount: 0.3, grainAmount: 0.15, halationAmount: 0.2 },
    qa: { yavgMin: 30, yavgMax: 60 },
  },
  'warm-editorial': {
    ...common,
    id: 'warm-editorial',
    name: 'Warm Editorial',
    preset: 'warm-editorial',
    palette: { background: '#f3ead9', surface: '#faf5ea', primary: '#2b2118', accent: '#b5532a', text: '#2b2118', highlight: '#fff8ec' },
    typography: { display: 'playfair-display', body: 'inter', scaleRatio: 1.25, ...tracking },
    lightingDefault: 'window',
    motionFamily: 'calm',
    toneMapping: 'agx',
    exposureEv: 0,
    // "warm gain": red up, blue down by the same small step.
    grade: { ...neutralGrade, gain: { r: 1.05, g: 1.01, b: 0.96 }, saturation: 1.05, contrast: 1.05, vignetteAmount: 0.15, grainAmount: 0.08 },
    qa: { yavgMin: 140, yavgMax: 170 },
  },
  'neon-tech': {
    ...common,
    id: 'neon-tech',
    name: 'Neon Tech',
    preset: 'neon-tech',
    palette: { background: '#070b1a', surface: '#0f1630', primary: '#e6f0ff', accent: '#39e6ff', text: '#e6f0ff', highlight: '#ff3ec9' },
    typography: { display: 'space-grotesk', body: 'inter', scaleRatio: 1.333, ...tracking },
    lightingDefault: 'neon-rim',
    motionFamily: 'snappy',
    toneMapping: 'agx',
    exposureEv: -0.3,
    // "cool shadows, split tone cyan/magenta 0.3, bloom via emission 0.3": cyan (190) in the shadows, magenta (310) in the highlights, the bloom as halation.
    grade: { ...neutralGrade, lift: { r: -0.01, g: 0, b: 0.02 }, saturation: 1.15, splitTone: { shadowHue: 190, shadowAmount: 0.3, highlightHue: 310, highlightAmount: 0.3 }, vignetteAmount: 0.2, grainAmount: 0.1, halationAmount: 0.3 },
    qa: { yavgMin: 40, yavgMax: 80 },
  },
  'paper-flat': {
    ...common,
    id: 'paper-flat',
    name: 'Paper Flat',
    preset: 'paper-flat',
    palette: { background: '#fbfaf6', surface: '#ffffff', primary: '#1f2937', accent: '#ef7d3b', text: '#1f2937', highlight: '#ffffff' },
    typography: { display: 'inter', body: 'inter', scaleRatio: 1.25, ...tracking },
    lightingDefault: 'soft-cross',
    motionFamily: 'snappy',
    toneMapping: 'standard',
    exposureEv: 0,
    grade: neutralGrade,
    // Paper white reads above 200 on a card frame of the html lane (the explainer's cards measured 207 to 212; the lookdev title card 218) and 174 to 176 on the 3D lanes under soft-cross, so the band spans both (widened 2026-10-30 from 150 to 190, which no paper-flat html frame could meet).
    qa: { yavgMin: 170, yavgMax: 225 },
  },
  'noir-title': {
    ...common,
    id: 'noir-title',
    name: 'Noir Title',
    preset: 'noir-title',
    palette: { background: '#000000', surface: '#0a0a0a', primary: '#f5f5f5', accent: '#c8c8c8', text: '#f5f5f5', highlight: '#ffffff' },
    typography: { display: 'playfair-display', body: 'inter', scaleRatio: 1.333, ...tracking },
    // The table offers split or contre-jour; split keeps a key, so the product shot of the lookdev sheet shows its halves.
    lightingDefault: 'split',
    motionFamily: 'cinematic',
    toneMapping: 'agx',
    exposureEv: -0.5,
    grade: { ...neutralGrade, saturation: 0.6, contrast: 1.15, contrastPivot: 0.4, vignetteAmount: 0.35, grainAmount: 0.25, halationAmount: 0.25 },
    qa: { yavgMin: 20, yavgMax: 50 },
  },
  'sunset-gradient': {
    ...common,
    id: 'sunset-gradient',
    name: 'Sunset Gradient',
    preset: 'sunset-gradient',
    palette: { background: '#2b1d3a', surface: '#3a2650', primary: '#ffe9d6', accent: '#ff9a5c', text: '#fff3e8', highlight: '#ffd7b0' },
    typography: { display: 'space-grotesk', body: 'inter', scaleRatio: 1.25, ...tracking },
    lightingDefault: 'golden-hour',
    motionFamily: 'calm',
    toneMapping: 'agx',
    exposureEv: 0,
    // "warm highlights, split tone orange/violet 0.35": violet (270) in the shadows, orange (30) in the highlights, the gain warm.
    grade: { ...neutralGrade, gain: { r: 1.04, g: 1, b: 0.96 }, saturation: 1.1, splitTone: { shadowHue: 270, shadowAmount: 0.35, highlightHue: 30, highlightAmount: 0.35 }, vignetteAmount: 0.2, grainAmount: 0.1 },
    qa: { yavgMin: 100, yavgMax: 140 },
  },
};

/** The preset names in the order the look bible lists them. */
export const lookPresetNames: readonly NamedLookPreset[] = ['studio-clean', 'obsidian', 'warm-editorial', 'neon-tech', 'paper-flat', 'noir-title', 'sunset-gradient'];
