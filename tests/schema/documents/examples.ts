/**
 * One valid example document per kind, typed with the generated contracts so
 * tsc checks them, plus the helpers the document, check and command tests
 * mutate them with. Not a test file: the test runner never loads it on its own.
 */
import assert from 'node:assert/strict';
import { SchemaValidationError } from '../../../src/errors/vision-forge-error.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import type { AssetsLedger } from '../../../src/shared/contracts/assets-ledger.ts';
import type { Brief } from '../../../src/shared/contracts/brief.ts';
import type { Job } from '../../../src/shared/contracts/job.ts';
import type { LookBible } from '../../../src/shared/contracts/look-bible.ts';
import type { Lane, Shot, ShotSpec, TextElement } from '../../../src/shared/contracts/shot-spec.ts';
import type { Treatment } from '../../../src/shared/contracts/treatment.ts';

/** 64 hex characters of one digit, for hashes. */
export function hex64(digit: string): string {
  return digit.repeat(64);
}

/** A deep copy with one change applied, for mutation tests. */
export function mutated<T>(document: T, change: (copy: T) => void): T {
  const copy = structuredClone(document);
  change(copy);
  return copy;
}

/** The schema problems of a document that must not validate; fails the test when it validates. */
export function schemaProblems(kind: string, document: unknown): readonly string[] {
  try {
    validateDocument(kind, document);
  } catch (error: unknown) {
    assert.ok(error instanceof SchemaValidationError, `expected SchemaValidationError, got ${String(error)}`);
    assert.equal(error.kind, kind);
    return error.problems;
  }
  assert.fail('the document validated but should not have');
}

/** The timestamp every example carries. */
export const exampleCreatedAt = '2026-10-26T20:00:00.000Z';

/** A product-shot brief at 1080p30. */
export const briefExample: Brief = {
  kind: 'brief',
  version: 1,
  id: 'obsidian-bottle',
  title: 'Obsidian bottle reveal',
  prompt: 'a 10 second product reveal of a black glass bottle',
  useCase: 'product-shot',
  goal: 'make the bottle feel premium',
  audience: 'shoppers on a product page',
  durationSeconds: 10,
  aspect: '16:9',
  fps: 30,
  width: 1920,
  height: 1080,
  tempo: 'calm',
  emotion: 'quiet confidence',
  genre: 'luxury advertising',
  era: null,
  paletteHints: ['deep black', 'silver'],
  mustHaveText: ['Now in 500 ml'],
  subject: { description: 'a matte black glass bottle with a silver cap', kind: 'product', primitive: 'bottle', assetIds: [] },
  narration: { enabled: false, voice: 'af_heart', script: null },
  music: { policy: 'none', path: null },
  limitsAcknowledged: ['no photoreal humans'],
  createdAt: exampleCreatedAt,
};

/** A two-beat treatment of the brief: three shots over two lanes. */
export const treatmentExample: Treatment = {
  kind: 'treatment',
  version: 1,
  id: 'obsidian-bottle-t1',
  briefId: 'obsidian-bottle',
  logline: 'A black bottle emerges from darkness as a single light sweeps its shoulder.',
  lookId: 'obsidian',
  beats: [
    { id: 'b1', title: 'Reveal', intent: 'establish the bottle as the hero', durationSeconds: 6, lane: 'three', shotIds: ['s01', 's02'] },
    { id: 'b2', title: 'Claim', intent: 'land the one line of text', durationSeconds: 4, lane: 'html', shotIds: ['s03'] },
  ],
  substitutions: [{ requested: 'a hand picking up the bottle', substitute: 'the bottle rises on a turntable', reason: 'photoreal humans are outside the limits the user acknowledged' }],
  risks: ['glass caustics may render noisy at the time budget'],
  narrationFirst: false,
  createdAt: exampleCreatedAt,
};

/** A title inside the title-safe area. */
export const textExample: TextElement = {
  id: 't1',
  role: 'title',
  content: 'Now in 500 ml',
  box: { x: 0.1, y: 0.7, w: 0.4, h: 0.12 },
  animation: 'fade-rise',
  staggerMs: 40,
  inFrame: 12,
  outFrame: 110,
};

/** A sound shot of the given length and lane, with no text and no asset. */
export function shotExample(id: string, durationFrames: number, lane: Lane): Shot {
  return {
    id,
    title: `Shot ${id}`,
    lane,
    durationFrames,
    size: 'MCU',
    angle: 'eye',
    dutchDegrees: 0,
    lens: { focalMm: 85, fStop: 2.8, focusDistanceM: 1.2, shutterAngleDeg: 180 },
    move: { preset: 'push-in', amplitude: 0.4, easing: 'standard-decelerate', startFrame: 0, endFrame: null },
    lighting: { preset: 'product-studio', keyIntensity: 1, fillRatio: 4, rimIntensity: 0.8, kelvin: 5600 },
    exposureOffsetEv: 0,
    composition: { anchor: 'thirds-right', headroomPct: 10, leadRoomPct: 15, textSide: 'left' },
    text: [],
    subject: { assetId: null, primitive: 'bottle', boundsM: { w: 0.08, h: 0.25, d: 0.08 } },
    atmosphere: { haze: 0.15, motes: 200 },
    narrationEvent: null,
    seed: 7,
    renderProfile: null,
  };
}

/** Three shots at 1080p30 with one dissolve and one cut; the first has passed the still gate. */
export const shotSpecExample: ShotSpec = {
  kind: 'shot-spec',
  version: 1,
  id: 'obsidian-bottle-shots',
  briefId: 'obsidian-bottle',
  treatmentId: 'obsidian-bottle-t1',
  lookId: 'obsidian',
  fps: 30,
  width: 1920,
  height: 1080,
  shots: [
    { ...shotExample('s01', 90, 'three'), renderProfile: { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' } },
    { ...shotExample('s02', 90, 'three'), move: { preset: 'turntable', amplitude: 0.6, easing: 'sine-in-out', startFrame: 10, endFrame: 80 } },
    { ...shotExample('s03', 120, 'html'), text: [textExample] },
  ],
  transitions: [
    { afterShotId: 's01', type: 'dissolve', frames: 15 },
    { afterShotId: 's02', type: 'cut', frames: 1 },
  ],
  createdAt: exampleCreatedAt,
};

/** A dark photographic look whose text clears WCAG AA over background and surface. */
export const lookBibleExample: LookBible = {
  kind: 'look-bible',
  version: 1,
  id: 'obsidian',
  name: 'Obsidian',
  preset: 'obsidian',
  palette: { background: '#0b0b0f', surface: '#16161d', primary: '#c9a84c', accent: '#4cc9c0', text: '#f4f1ea', highlight: '#ffffff' },
  typography: { display: 'playfair-display', body: 'inter', scaleRatio: 1.25, displayTrackingEm: -0.02, uppercaseTrackingEm: 0.08 },
  lightingDefault: 'product-studio',
  motionFamily: 'cinematic',
  toneMapping: 'agx',
  exposureEv: -0.3,
  grade: {
    lift: { r: 0.02, g: 0, b: -0.01 },
    gamma: { r: 1, g: 1, b: 1 },
    gain: { r: 1.05, g: 1, b: 0.98 },
    saturation: 0.9,
    contrast: 1.1,
    contrastPivot: 0.18,
    splitTone: { shadowHue: 220, shadowAmount: 0.15, highlightHue: 40, highlightAmount: 0.1 },
    vignetteAmount: 0.25,
    vignetteSoftness: 0.6,
    grainAmount: 0.15,
    grainSeed: 7,
    halationAmount: 0.1,
  },
  qa: { yavgMin: 24, yavgMax: 140 },
  createdAt: exampleCreatedAt,
};

/** A planned job with one shot per shot-spec shot. */
export const jobExample: Job = {
  kind: 'job',
  version: 1,
  id: 'k7f2q9x1',
  createdAt: exampleCreatedAt,
  briefPath: 'C:/vf/out/k7f2q9x1/brief.json',
  treatmentPath: 'C:/vf/out/k7f2q9x1/treatment.json',
  shotSpecPath: 'C:/vf/out/k7f2q9x1/shot-spec.json',
  lookPath: 'C:/vf/out/k7f2q9x1/look-bible.json',
  outDir: 'C:/vf/out/k7f2q9x1',
  dataDir: 'C:/Users/me/AppData/Local/VisionForge',
  status: 'stills',
  shots: [
    { id: 's01', key: hex64('a'), status: 'still-rendered', manifestPath: null, stillPath: 'C:/vf/out/k7f2q9x1/stills/s01-r1.png', rounds: 1 },
    { id: 's02', key: hex64('b'), status: 'pending', manifestPath: null, stillPath: null, rounds: 0 },
    { id: 's03', key: hex64('c'), status: 'pending', manifestPath: null, stillPath: null, rounds: 0 },
  ],
  deliverablePath: null,
};

/** A ledger with a font and an HDRI, as src/net/asset-ledger.ts writes it. */
export const assetsLedgerExample: AssetsLedger = {
  kind: 'assets-ledger',
  version: 1,
  assets: [
    {
      id: 'font:inter',
      source: 'https://github.com/google/fonts/raw/main/ofl/inter/OFL.txt',
      finalUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt',
      license: 'OFL-1.1',
      bytes: 1953,
      sha256: hex64('a'),
      fetchedAt: '2026-10-26T12:00:00.000Z',
      files: ['fonts/inter/OFL.txt'],
    },
    {
      id: 'hdri:studio_small_09',
      source: 'https://dl.polyhaven.com/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
      finalUrl: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
      license: 'CC0-1.0',
      bytes: 1615248,
      sha256: hex64('b'),
      md5: 'c'.repeat(32),
      fetchedAt: '2026-10-26T12:01:00.000Z',
      credit: 'HDRI by Poly Haven (CC0)',
      files: ['hdri/studio_small_09_1k.hdr', 'hdri/studio_small_09.json'],
    },
  ],
};
