/**
 * The pinned catalogue of downloadable assets: what may be fetched, from
 * where, how big it is and what it must hash to. Nothing is downloaded that
 * is not listed here, and every pin (URL, size, MD5) was read from Poly
 * Haven's file API (api.polyhaven.com/files/<name>) on 2026-10-29. A changed
 * pin is a deliberate edit with a new date, never a silent update.
 */
import type { LightingPreset } from '../shared/contracts/look-bible.ts';

/** The kinds of asset the catalogue lists; models join in a later milestone. */
export type CatalogueKind = 'hdri';

/** The HDRI resolutions Poly Haven publishes that the catalogue pins. */
export type HdriResolution = '1k' | '2k';

/** One downloadable asset and its pin. */
export interface CatalogueEntry {
  /** `<kind>:<name>-<resolution>`, for example "hdri:studio_small_09-1k"; also the ledger id. */
  readonly id: string;
  readonly kind: CatalogueKind;
  /** The source's own name for the asset, for example "studio_small_09". */
  readonly name: string;
  readonly url: string;
  readonly bytes: number;
  /** The MD5 the source publishes, 32 lowercase hex characters; the downloader verifies it. */
  readonly md5: string;
  readonly license: 'CC0-1.0';
  /** The attribution line credits files carry. */
  readonly credit: string;
  /** Where the file lands, relative to the data directory, with forward slashes. */
  readonly file: string;
  /** Colour temperature of the dominant light in kelvin, or null when the source gives none. */
  readonly kelvin: number | null;
  readonly description: string;
  readonly tags: readonly string[];
}

/** The things one HDRI shares across its resolutions. */
interface HdriSource {
  readonly name: string;
  readonly title: string;
  readonly authors: string;
  readonly kelvin: number | null;
  readonly description: string;
  readonly tags: readonly string[];
  /** Size and MD5 per resolution, from the file API. */
  readonly files: Readonly<Record<HdriResolution, { readonly bytes: number; readonly md5: string }>>;
}

/** The five HDRIs the lighting presets draw on. */
const hdriSources: readonly HdriSource[] = [
  {
    name: 'studio_small_09',
    title: 'Studio Small 09',
    authors: 'Sergej Majboroda',
    kelvin: 2750,
    description: 'Octaboxes on a white cyc: the neutral product studio.',
    tags: ['studio', 'softbox', 'product'],
    files: { '1k': { bytes: 1615248, md5: 'd5d7eb9d26d341d6aa4d11c1a54fd97c' }, '2k': { bytes: 6312947, md5: 'b056fea247bc84b81d2e0987d44c87d8' } },
  },
  {
    name: 'studio_small_03',
    title: 'Studio Small 03',
    authors: 'Greg Zaal',
    kelvin: null,
    description: 'A dark studio with a few hard sources: the low-key and rim looks.',
    tags: ['studio', 'low-key', 'rim'],
    files: { '1k': { bytes: 1686299, md5: '74e6ef69ea9024c2cc25b3a7de8ec2f7' }, '2k': { bytes: 6673807, md5: 'ec6591c2a18e9bbb27206b99b28dade5' } },
  },
  {
    name: 'brown_photostudio_02',
    title: 'Brown Photostudio 02',
    authors: 'Sergej Majboroda',
    kelvin: 5800,
    description: 'A warm photo studio with window light: the window and Rembrandt looks.',
    tags: ['studio', 'warm', 'window'],
    files: { '1k': { bytes: 1648130, md5: '1362911793f932724326e6e56421f102' }, '2k': { bytes: 6492863, md5: '15f9d0a5bde4a67e0b7d266f07bc166c' } },
  },
  {
    name: 'kloofendal_48d_partly_cloudy_puresky',
    title: 'Kloofendal 48d Partly Cloudy (Pure Sky)',
    authors: 'Greg Zaal and Jarod Guest',
    kelvin: 5400,
    description: 'An outdoor sky with a low sun: the golden-hour and overcast rigs.',
    tags: ['outdoor', 'sky', 'golden-hour', 'overcast'],
    files: { '1k': { bytes: 1435119, md5: 'c69498687e876bf68d2a8b8a62234eb9' }, '2k': { bytes: 5451493, md5: '2eba3a4d7eeb23cbfbeca364c97e7980' } },
  },
  {
    name: 'moonless_golf',
    title: 'Moonless Golf',
    authors: 'Greg Zaal',
    kelvin: 3942,
    description: 'A moonless night lit by distant sodium lamps: the neon-night and low-key rigs.',
    tags: ['night', 'outdoor', 'neon'],
    files: { '1k': { bytes: 1672754, md5: 'da9edde9ad39465900a7935dc15ab8d7' }, '2k': { bytes: 6688317, md5: '804fae62fb961da3faad6c13a1a72147' } },
  },
];

const hdriResolutions: readonly HdriResolution[] = ['1k', '2k'];

/** The catalogue entry for one HDRI at one resolution. */
function hdriEntry(source: HdriSource, resolution: HdriResolution): CatalogueEntry {
  const pin = source.files[resolution];
  return {
    id: `hdri:${source.name}-${resolution}`,
    kind: 'hdri',
    name: source.name,
    url: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${resolution}/${source.name}_${resolution}.hdr`,
    bytes: pin.bytes,
    md5: pin.md5,
    license: 'CC0-1.0',
    credit: `${source.title} by ${source.authors}, Poly Haven (CC0)`,
    file: `assets/hdri/${source.name}_${resolution}.hdr`,
    kelvin: source.kelvin,
    description: `${source.title}, ${resolution}. ${source.description}`,
    tags: source.tags,
  };
}

/** Every downloadable asset: the five HDRIs at 1k and 2k, in source order. */
export const catalogue: readonly CatalogueEntry[] = hdriSources.flatMap((source) => hdriResolutions.map((resolution) => hdriEntry(source, resolution)));

/** The entry with this id, or undefined. */
export function findCatalogueEntry(id: string): CatalogueEntry | undefined {
  return catalogue.find((entry) => entry.id === id);
}

/** Every catalogue id, in catalogue order. */
export function catalogueIds(): readonly string[] {
  return catalogue.map((entry) => entry.id);
}

/**
 * Which HDRI lights each preset. The studio presets that want soft, even
 * light take Studio Small 09 (octaboxes on a white cyc); the window and
 * Rembrandt looks take Brown Photostudio 02 (warm window light); the
 * low-key family (split, rim-only, contre-jour, practical-glow, neon-rim)
 * takes Studio Small 03, whose dark room keeps the fill low; golden-hour
 * takes the Kloofendal sky; neon-night takes Moonless Golf. The record type
 * makes the compiler refuse a preset without an HDRI. Exported so the MCP
 * prompt can print the table for the directing model.
 */
export const hdriByLighting: Readonly<Record<LightingPreset, string>> = {
  'product-studio': 'studio_small_09',
  'three-point-soft': 'studio_small_09',
  'high-key': 'studio_small_09',
  butterfly: 'studio_small_09',
  'overcast-soft': 'studio_small_09',
  'soft-cross': 'studio_small_09',
  window: 'brown_photostudio_02',
  rembrandt: 'brown_photostudio_02',
  'low-key': 'studio_small_03',
  split: 'studio_small_03',
  'rim-only': 'studio_small_03',
  'contre-jour': 'studio_small_03',
  'practical-glow': 'studio_small_03',
  'neon-rim': 'studio_small_03',
  'golden-hour': 'kloofendal_48d_partly_cloudy_puresky',
  'neon-night': 'moonless_golf',
};

/** The HDRI a lighting preset uses at a resolution (the mapping is documented on hdriByLighting). */
export function hdriForLighting(preset: LightingPreset, resolution: HdriResolution): CatalogueEntry {
  const id = `hdri:${hdriByLighting[preset]}-${resolution}`;
  const entry = findCatalogueEntry(id);
  // Every mapped name is in hdriSources and every resolution is pinned, so this cannot happen; the throw keeps the return type honest.
  if (entry === undefined) throw new Error(`The catalogue has no entry ${id} for the ${preset} preset.`);
  return entry;
}
