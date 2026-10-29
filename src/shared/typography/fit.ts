/**
 * Fits a text element into its box without measuring glyphs: the type
 * scale gives a role's size, and the box is the authority. Lines are
 * estimated by greedy word wrapping at an average character width per
 * family, and the size shrinks one pixel at a time until the estimated
 * lines fit the box height, never below the caller's floor. The html lane
 * sets the fitted size and the composition check reports a box the text
 * cannot fit at its floor, so the planner and the renderer agree on the
 * same estimate; the browser's own measurement (InitReport.textOverflows)
 * then confirms the real layout.
 */
import type { FontFamily, LookBible } from '../contracts/look-bible.ts';
import type { TextRole } from '../contracts/shot-spec.ts';
import { roleFamily, roleLineHeights, roleSizePx, roleTrackingEm, roleUppercase, roleWeight } from './scale.ts';

/** Average advance width of a character as a fraction of the font size, per family, for regular weights. */
export const averageCharacterWidthEm: Readonly<Record<FontFamily, number>> = {
  inter: 0.5,
  'space-grotesk': 0.52,
  'playfair-display': 0.5,
  'jetbrains-mono': 0.6,
};

/** Extra average width for heavy weights (700 and up), in em. */
export const heavyWeightWidthEm = 0.03;

/** Width multiplier for capitals. */
export const uppercaseWidthFactor = 1.15;

/** What the fit decided for one element. */
export interface TextFit {
  /** The font size to set, in pixels. */
  readonly fontSizePx: number;
  /** The estimated lines at that size. */
  readonly lines: readonly string[];
  /** True when the text fits the box at fontSizePx; false when even the floor does not fit. */
  readonly fits: boolean;
  /** The size the role's scale asked for before any shrinking. */
  readonly scaleSizePx: number;
}

/** The estimated width of a text in pixels at a font size: characters times the family's average advance plus the tracking, capitals widened. */
export function estimateTextWidthPx(text: string, fontSizePx: number, family: FontFamily, weight: number, trackingEm: number, uppercase: boolean): number {
  const characters = [...text].length;
  const perCharacter = (averageCharacterWidthEm[family] + (weight >= 700 ? heavyWeightWidthEm : 0) + trackingEm) * fontSizePx;
  return characters * perCharacter * (uppercase ? uppercaseWidthFactor : 1);
}

/** The lines of a text wrapped greedily at a width: words that fit stay together, a word wider than the line stands alone; explicit newlines always break. */
export function wrapText(content: string, widthPx: number, measure: (text: string) => number): readonly string[] {
  const lines: string[] = [];
  for (const paragraph of content.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (line.length === 0 || measure(candidate) <= widthPx) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The lines of an element's content at a font size, as the lane is expected to wrap them. */
export function estimateLines(content: string, role: TextRole, fontSizePx: number, boxWidthPx: number, typography: LookBible['typography']): readonly string[] {
  const family = roleFamily(role, typography);
  const weight = roleWeight(role, family);
  const tracking = roleTrackingEm(role, typography);
  const uppercase = roleUppercase(role);
  return wrapText(content, boxWidthPx, (text) => estimateTextWidthPx(text, fontSizePx, family, weight, tracking, uppercase));
}

/** The height in pixels of a number of lines at a font size for a role. */
export function linesHeightPx(role: TextRole, fontSizePx: number, lineCount: number): number {
  return lineCount * fontSizePx * roleLineHeights[role];
}

/**
 * The font size for an element: the role's scale size, shrunk one pixel at
 * a time while the estimated lines overflow the box height or a single
 * word overflows the box width, stopping at `minPx`. `boxWidthPx` and
 * `boxHeightPx` are the box's inner size (after any plate padding).
 */
export function fitTextSize(content: string, role: TextRole, boxWidthPx: number, boxHeightPx: number, typography: LookBible['typography'], frameHeightPx: number, minPx: number): TextFit {
  const scaleSizePx = roleSizePx(role, typography.scaleRatio, frameHeightPx);
  const floor = Math.max(1, Math.min(minPx, scaleSizePx));
  const family = roleFamily(role, typography);
  const weight = roleWeight(role, family);
  const tracking = roleTrackingEm(role, typography);
  const uppercase = roleUppercase(role);
  for (let size = scaleSizePx; size >= floor; size -= 1) {
    const measure = (text: string): number => estimateTextWidthPx(text, size, family, weight, tracking, uppercase);
    const lines = wrapText(content, boxWidthPx, measure);
    const widest = Math.max(0, ...lines.map(measure));
    if (widest <= boxWidthPx && linesHeightPx(role, size, lines.length) <= boxHeightPx) return { fontSizePx: size, lines, fits: true, scaleSizePx };
    if (size === floor) return { fontSizePx: size, lines, fits: false, scaleSizePx };
  }
  const lines = estimateLines(content, role, floor, boxWidthPx, typography);
  return { fontSizePx: floor, lines, fits: false, scaleSizePx };
}
