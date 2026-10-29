/**
 * The composition checks of composition/rules.md ("Checks the solver runs
 * on every still"), numbers 1 to 5, on one camera frame of a shot: each
 * failure is one sentence the planner or the still gate can print. Checks
 * 6 (contrast behind each text box) and 7 (average luma) need the finished
 * frame's pixels and belong to the qa module, not here.
 *
 * Every box is in frame fractions (grid.ts); pixel sizes are derived from
 * the render spec only inside check 5. ECU is the one exception to check
 * 1: its subject is 1.5 to 2.5 frame heights tall by definition, so the
 * frame sits inside the subject and the check is skipped for that size.
 */
import { project, projectBox } from '../camera/project.ts';
import type { CameraFrame, FrameBox, RenderSpec } from '../camera/types.ts';
import type { LookBible } from '../contracts/look-bible.ts';
import type { Shot, TextElement, TextRole } from '../contracts/shot-spec.ts';
import { fitTextSize } from '../typography/fit.ts';
import { framingPoint, subjectAnchor, verticalPlacement } from './framing.ts';
import { anchorToleranceFraction, boxesOverlap, gridPoint, insideBox, safeAreas } from './grid.ts';
import { headroomRange, shotSizeRanges } from './sizes.ts';

/** The reference frame height in pixels the text floors are written for. */
export const referenceHeightPx = 1080;

/**
 * The minimum text height in pixels at 1080p for each role. Where
 * composition/rules.md names a floor it is used as written: titles 72
 * and up, body 32, captions and labels 24. The other roles have no floor
 * in rules.md, so theirs is the smallest typical size typography/system.md
 * gives them: subtitle 56, lower-third-name 44, lower-third-title 28,
 * counter 96. The floors scale with the frame height (check 5).
 */
export const textHeightFloorsPx: Readonly<Record<TextRole, number>> = {
  title: 72,
  subtitle: 56,
  body: 32,
  caption: 24,
  label: 24,
  'lower-third-name': 44,
  'lower-third-title': 28,
  counter: 96,
};

/** The maximum characters on one line, counted in Unicode code points (an emoji or an accented letter is one character): 42 for titles and subtitles, 60 for every other role (the caption limit). */
export function maxCharactersPerLine(role: TextRole): number {
  return role === 'title' || role === 'subtitle' ? 42 : 60;
}

/** The headroom tolerance in frame fractions: the solver's residual after its exact slide is about 1e-16, so a headroom asked for at a range edge still passes check 4. */
export const headroomEpsilon = 1e-6;

/** The maximum lines of one text element. */
export const maxLines = 3;

/** A second text box larger than this fraction of the largest text box's area competes with it. */
export const competingAreaFraction = 1 / 3;

/** The lines of a text element: its content split on newlines, as the renderer breaks it. */
export function textLines(text: TextElement): readonly string[] {
  return text.content.split('\n');
}

/** True when the last of several lines holds a single word (an orphan). */
export function hasOrphan(lines: readonly string[]): boolean {
  if (lines.length < 2) return false;
  const last = lines[lines.length - 1] ?? '';
  return last.trim().split(/\s+/).filter((word) => word.length > 0).length === 1;
}

/** Formats a frame fraction as a percentage with one decimal for a sentence. */
function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** True for the sizes whose subject is taller than the frame by definition (ECU), where check 1 cannot hold. */
function frameInsideSubject(shot: Shot): boolean {
  return shotSizeRanges[shot.size].min > 1;
}

/** Check 1: the subject's projected box lies inside the action-safe area; skipped for ECU, where the frame sits inside the subject. */
function subjectInsideActionSafe(shot: Shot, box: FrameBox): readonly string[] {
  if (frameInsideSubject(shot) || insideBox(box, safeAreas.action)) return [];
  return [`The subject box (left ${percent(box.x)}, top ${percent(box.y)}, width ${percent(box.w)}, height ${percent(box.h)}) leaves the action-safe area (the central 93%).`];
}

/**
 * Check 2: the projected framing point sits within 4 percent of the frame
 * width of its grid point. The distance is measured in frame widths, so
 * the vertical offset is divided by the aspect ratio. When headroom or the
 * ground angle owns the vertical placement only the horizontal offset
 * counts; check 4 then verifies the vertical placement.
 */
function anchorOnGrid(shot: Shot, frame: CameraFrame, aspect: number): readonly string[] {
  const projected = project(framingPoint(shot), frame, aspect);
  if (projected === null) return ['The subject anchor is behind the camera.'];
  const grid = gridPoint(shot.composition.anchor);
  const dx = projected.x - grid.x;
  const dy = verticalPlacement(shot) === 'grid' ? (projected.y - grid.y) / aspect : 0;
  const offset = Math.hypot(dx, dy);
  if (offset <= anchorToleranceFraction) return [];
  return [`The subject anchor projects at (${percent(projected.x)}, ${percent(projected.y)}), ${percent(offset)} of the frame width from the ${shot.composition.anchor} grid point (${percent(grid.x)}, ${percent(grid.y)}); the tolerance is ${percent(anchorToleranceFraction)}.`];
}

/** Check 3: every text box lies inside the title-safe area and does not overlap the subject's box. */
function textBoxesClear(shot: Shot, subjectBox: FrameBox): readonly string[] {
  const problems: string[] = [];
  for (const text of shot.text) {
    if (!insideBox(text.box, safeAreas.title)) problems.push(`Text ${text.id} (${text.role}) leaves the title-safe area (the central 90%).`);
    if (boxesOverlap(text.box, subjectBox)) problems.push(`Text ${text.id} (${text.role}) overlaps the subject box.`);
  }
  return problems;
}

/** Check 4: the headroom (frame top to the subject box's top, as a fraction of the frame height) lies in the size's range, widened by headroomEpsilon, when it has one. */
function headroomInRange(shot: Shot, subjectBox: FrameBox): readonly string[] {
  const range = headroomRange(shot.size);
  if (range === null || range.max === 0) return [];
  const headroom = subjectBox.y;
  if (headroom >= range.min - headroomEpsilon && headroom <= range.max + headroomEpsilon) return [];
  return [`The headroom above the subject is ${percent(headroom)} of the frame height; a ${shot.size} needs ${percent(range.min)} to ${percent(range.max)}.`];
}

/** The floor of a role in pixels at a frame height. */
export function textFloorPx(role: TextRole, heightPx: number): number {
  return (textHeightFloorsPx[role] * heightPx) / referenceHeightPx;
}

/**
 * Check 5 for one text element: the box height in pixels against the
 * role's floor, then (with the look's type scale) whether the content fits
 * the box at or above the floor as typography/fit.ts estimates it, the
 * line count, the line lengths and orphans.
 */
function textLegible(text: TextElement, spec: RenderSpec, typography: LookBible['typography'] | undefined): readonly string[] {
  const problems: string[] = [];
  const heightPx = text.box.h * spec.height;
  const floorPx = textFloorPx(text.role, spec.height);
  if (heightPx < floorPx) problems.push(`Text ${text.id} (${text.role}) is ${heightPx.toFixed(1)} px tall; the floor for its role at ${spec.height} px is ${floorPx.toFixed(1)} px.`);
  if (typography !== undefined) {
    const fit = fitTextSize(text.content, text.role, text.box.w * spec.width, heightPx, typography, spec.height, floorPx);
    if (!fit.fits) problems.push(`Text ${text.id} (${text.role}) does not fit its box even at the ${Math.round(floorPx)} px floor (${fit.lines.length} estimated line${fit.lines.length === 1 ? '' : 's'} at the look's type scale); widen or heighten the box or shorten the text.`);
  }
  const lines = textLines(text);
  if (lines.length > maxLines) problems.push(`Text ${text.id} (${text.role}) has ${lines.length} lines; at most ${maxLines} are allowed.`);
  const limit = maxCharactersPerLine(text.role);
  for (const [index, line] of lines.entries()) {
    const characters = [...line].length;
    if (characters > limit) problems.push(`Text ${text.id} (${text.role}) line ${index + 1} has ${characters} characters; at most ${limit} are allowed.`);
  }
  if (hasOrphan(lines)) problems.push(`Text ${text.id} (${text.role}) ends with a single word alone on its last line.`);
  return problems;
}

/**
 * The composition problems of one frame of a shot, checks 1 to 5 of
 * composition/rules.md, each as one sentence; an empty array means the
 * frame passes. A subject box behind the camera is reported once and
 * skips the checks that need it. Check 1 is skipped for ECU, whose
 * subject is taller than the frame by definition. Pure: the same inputs
 * give the same sentences in the same order.
 */
export function compositionProblems(shot: Shot, spec: RenderSpec, frame: CameraFrame, typography?: LookBible['typography']): readonly string[] {
  const aspect = spec.width / spec.height;
  const subjectBox = projectBox(shot.subject.boundsM, subjectAnchor, frame, aspect);
  const problems: string[] = [];
  if (subjectBox === null) {
    problems.push('The subject box is partly behind the camera.');
  } else {
    problems.push(...subjectInsideActionSafe(shot, subjectBox));
  }
  problems.push(...anchorOnGrid(shot, frame, aspect));
  if (subjectBox !== null) {
    problems.push(...textBoxesClear(shot, subjectBox));
    problems.push(...headroomInRange(shot, subjectBox));
  }
  for (const text of shot.text) problems.push(...textLegible(text, spec, typography));
  return problems;
}

/** The area of a frame box as a fraction of the frame's area. */
function boxArea(box: FrameBox): number {
  return box.w * box.h;
}

/**
 * The visual-weight warnings of a shot (composition/rules.md "Visual
 * weight"): one dominant text element per frame; every other text box
 * whose area is more than a third of the largest text box's area competes
 * with it. Warnings do not fail a still.
 */
export function compositionWarnings(shot: Shot): readonly string[] {
  if (shot.text.length < 2) return [];
  const largest = shot.text.reduce((best, text) => (boxArea(text.box) > boxArea(best.box) ? text : best));
  const limit = boxArea(largest.box) * competingAreaFraction;
  const warnings: string[] = [];
  for (const text of shot.text) {
    if (text === largest) continue;
    if (boxArea(text.box) > limit) warnings.push(`Text ${text.id} (${text.role}) covers ${percent(boxArea(text.box))} of the frame, more than a third of the largest text ${largest.id} (${percent(boxArea(largest.box))}); one element should dominate.`);
  }
  return warnings;
}
