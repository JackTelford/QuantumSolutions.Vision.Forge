/**
 * The type system of typography/system.md as numbers: the four bundled OFL
 * families with their files and weight ranges, the size of every text role
 * at the look's scale ratio and the frame height, line heights, tracking,
 * case and the @font-face rules the harness page carries. The html lane
 * sets its styles from here; the composition checks keep their own floors
 * (composition/checks.ts), which these sizes always clear.
 */
import type { FontFamily, LookBible } from '../contracts/look-bible.ts';
import type { TextRole } from '../contracts/shot-spec.ts';

/** One bundled variable font: its file under the fonts root, its CSS family name and the weight range the file covers. */
export interface BundledFont {
  readonly family: FontFamily;
  /** File name under skills/cinematic-studio/assets/fonts/. */
  readonly file: string;
  /** The family name the @font-face rule declares and the CSS uses. */
  readonly cssFamily: string;
  readonly minWeight: number;
  readonly maxWeight: number;
  /** SPDX identifier of the font's license. */
  readonly license: 'OFL-1.1';
  /** The file in google/fonts the bundled copy was taken from, at the pinned commit. */
  readonly sourcePath: string;
  readonly sha256: string;
}

/** The google/fonts commit the four files were taken from (raw.githubusercontent.com/google/fonts/<commit>/ofl/...). */
export const fontsSourceCommit = '6157dfaa640ca5738b4d1a7070fe389c3036d7fc';

/** The four bundled families, in the order the typography reference lists them. */
export const bundledFonts: Readonly<Record<FontFamily, BundledFont>> = {
  inter: { family: 'inter', file: 'Inter.ttf', cssFamily: 'Inter', minWeight: 100, maxWeight: 900, license: 'OFL-1.1', sourcePath: 'ofl/inter/Inter[opsz,wght].ttf', sha256: '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031' },
  'space-grotesk': { family: 'space-grotesk', file: 'SpaceGrotesk.ttf', cssFamily: 'Space Grotesk', minWeight: 300, maxWeight: 700, license: 'OFL-1.1', sourcePath: 'ofl/spacegrotesk/SpaceGrotesk[wght].ttf', sha256: 'acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72' },
  'playfair-display': { family: 'playfair-display', file: 'PlayfairDisplay.ttf', cssFamily: 'Playfair Display', minWeight: 400, maxWeight: 900, license: 'OFL-1.1', sourcePath: 'ofl/playfairdisplay/PlayfairDisplay[wght].ttf', sha256: 'c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6' },
  'jetbrains-mono': { family: 'jetbrains-mono', file: 'JetBrainsMono.ttf', cssFamily: 'JetBrains Mono', minWeight: 100, maxWeight: 800, license: 'OFL-1.1', sourcePath: 'ofl/jetbrainsmono/JetBrainsMono[wght].ttf', sha256: '48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda' },
};

/** The license text file bundled beside each font, named <file stem>-OFL.txt. */
export function fontLicenseFile(font: BundledFont): string {
  return `${font.file.replace(/\.ttf$/, '')}-OFL.txt`;
}

/** The frame height the sizes are written for. */
export const referenceHeightPx = 1080;

/** The two scale ratios the look bible allows (major third, perfect fourth). */
export const scaleRatios = { minor: 1.25, major: 1.333 } as const;

/** Size of a role at 1080p at each scale ratio, from the typography reference's table (the upper end of each range, so titles read as titles). */
export const roleSizesPx: Readonly<Record<TextRole, { readonly minor: number; readonly major: number }>> = {
  title: { minor: 140, major: 160 },
  subtitle: { minor: 56, major: 64 },
  body: { minor: 32, major: 32 },
  caption: { minor: 28, major: 28 },
  label: { minor: 26, major: 26 },
  'lower-third-name': { minor: 44, major: 48 },
  'lower-third-title': { minor: 28, major: 30 },
  counter: { minor: 120, major: 120 },
};

/** Line height per role: 1.1 for titles, 1.35 for body, 1.25 for captions and labels. */
export const roleLineHeights: Readonly<Record<TextRole, number>> = {
  title: 1.1,
  subtitle: 1.1,
  body: 1.35,
  caption: 1.25,
  label: 1.25,
  'lower-third-name': 1.1,
  'lower-third-title': 1.25,
  counter: 1,
};

/** Roles set in the look's display family; the rest use the body family. */
export const displayRoles: ReadonlySet<TextRole> = new Set<TextRole>(['title', 'subtitle', 'lower-third-name']);

/** Roles set in capitals (the reference allows labels in caps and sets lower-third titles in caps). */
export const uppercaseRoles: ReadonlySet<TextRole> = new Set<TextRole>(['lower-third-title']);

/** Roles whose digits must not jitter: tabular figures. */
export const tabularRoles: ReadonlySet<TextRole> = new Set<TextRole>(['counter', 'label']);

/** The font size of a role in pixels for a frame height, interpolating between the two scale ratios and scaling with the height; whole pixels. */
export function roleSizePx(role: TextRole, scaleRatio: number, heightPx: number): number {
  const sizes = roleSizesPx[role];
  const span = scaleRatios.major - scaleRatios.minor;
  const t = Math.min(1, Math.max(0, (scaleRatio - scaleRatios.minor) / span));
  const at1080 = sizes.minor + (sizes.major - sizes.minor) * t;
  return Math.round((at1080 * heightPx) / referenceHeightPx);
}

/** The font family of a role under a look: display roles use the display family, the rest the body family. */
export function roleFamily(role: TextRole, typography: LookBible['typography']): FontFamily {
  return displayRoles.has(role) ? typography.display : typography.body;
}

/** The weight of a role in a family: titles heavy, subtitles and names medium-heavy, running text regular. */
export function roleWeight(role: TextRole, family: FontFamily): number {
  const font = bundledFonts[family];
  const heavy = family === 'inter' ? 800 : 700;
  const medium = family === 'inter' ? 600 : family === 'space-grotesk' ? 500 : 400;
  const weight = role === 'title' || role === 'counter' ? heavy : role === 'subtitle' || role === 'lower-third-name' || role === 'label' ? medium : 400;
  return Math.min(font.maxWeight, Math.max(font.minWeight, weight));
}

/** Letter spacing of a role in em: the look's display tracking for titles, its uppercase tracking for capitals, −0.01 for names, 0 otherwise. */
export function roleTrackingEm(role: TextRole, typography: LookBible['typography']): number {
  if (role === 'title') return typography.displayTrackingEm;
  if (uppercaseRoles.has(role)) return typography.uppercaseTrackingEm;
  if (role === 'lower-third-name') return -0.01;
  return 0;
}

/** True when the role is set in capitals. */
export function roleUppercase(role: TextRole): boolean {
  return uppercaseRoles.has(role);
}

/** The @font-face rules for the four bundled fonts under a URL prefix such as "/fonts/", one per family, with their weight ranges. */
export function fontFaceCss(fontsUrl: string): string {
  return Object.values(bundledFonts)
    .map((font) => `@font-face { font-family: '${font.cssFamily}'; src: url('${fontsUrl}${font.file}') format('truetype'); font-weight: ${font.minWeight} ${font.maxWeight}; font-style: normal; font-display: block; }`)
    .join('\n');
}

/** The "family weight" descriptors a page asks document.fonts to load before its first frame: both of the look's families at every weight the roles use. */
export function fontFacesToLoad(typography: LookBible['typography']): readonly string[] {
  const descriptors = new Set<string>();
  for (const role of Object.keys(roleSizesPx) as TextRole[]) {
    const family = roleFamily(role, typography);
    descriptors.add(`${roleWeight(role, family)} 16px '${bundledFonts[family].cssFamily}'`);
  }
  return [...descriptors].sort();
}
