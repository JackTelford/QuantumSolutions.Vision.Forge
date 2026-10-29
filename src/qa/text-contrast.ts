/**
 * text-contrast: for each text box the caller names (a frame, a normalized
 * rectangle and the text colour), the average luma of the whole box is
 * measured with signalstats on a crop of the extracted frame and turned
 * into a WCAG contrast ratio against the text colour (see luminance.ts).
 * A ratio under 4.5:1 fails the check.
 *
 * The average includes the text pixels themselves, since on a delivery the
 * text is already burnt in. That pulls the estimate toward the text colour,
 * so the ratio is a lower bound of the true text-to-background ratio: the
 * check can fail text that would pass, never pass text that would fail.
 *
 * The text-boxes file is a JSON array:
 * `[{ "frame": 12, "box": { "x": 0.1, "y": 0.8, "w": 0.5, "h": 0.1 }, "textColor": "#ffffff" }]`
 * with x, y, w and h as fractions of the frame size.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataFileError } from '../errors/vision-forge-error.ts';
import { readJsonFile } from '../fs/atomic-json.ts';
import { isJsonObject } from '../schema/schema-registry.ts';
import type { Check } from '../shared/contracts/qa-report.ts';
import { filterPath } from '../tools/ffmpeg.ts';
import type { Analysis } from './check.ts';
import { makeCheck, round, runAnalysis, unmeasured } from './check.ts';
import { extractFrame } from './frame-extract.ts';
import { contrastRatio, isHexColor, relativeLuminanceOfHex, relativeLuminanceOfLuma } from './luminance.ts';
import { parseSignalstatsYavg } from './parse.ts';

/** A rectangle as fractions (0 to 1) of the frame width and height. */
export interface NormalizedBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One text box to check. */
export interface TextBox {
  /** Frame number counted from 0. */
  readonly frame: number;
  readonly box: NormalizedBox;
  /** The text colour as "#rrggbb". */
  readonly textColor: string;
}

/** A rectangle in whole pixels. */
export interface PixelBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The WCAG AA ratio for normal text. */
export const contrastThreshold = 4.5;

const textBoxesHint = 'The file is a JSON array of { "frame": <integer>, "box": { "x", "y", "w", "h" as fractions 0 to 1 }, "textColor": "#rrggbb" }.';

function fraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Turns the parsed JSON of a text-boxes file into TextBox records; throws DataFileError naming the first bad entry. */
export function parseTextBoxes(value: unknown, path: string): TextBox[] {
  if (!Array.isArray(value)) throw new DataFileError(path, 'the text boxes file is not a JSON array', textBoxesHint);
  return value.map((entry: unknown, index: number): TextBox => {
    const where = `entry ${index}`;
    if (!isJsonObject(entry)) throw new DataFileError(path, `${where} is not an object`, textBoxesHint);
    const frame = entry['frame'];
    const box = entry['box'];
    const textColor = entry['textColor'];
    if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 0) throw new DataFileError(path, `${where} has no integer "frame" of 0 or more`, textBoxesHint);
    if (!isJsonObject(box) || !fraction(box['x']) || !fraction(box['y']) || !fraction(box['w']) || !fraction(box['h']) || box['w'] === 0 || box['h'] === 0) {
      throw new DataFileError(path, `${where} has no "box" with x, y, w and h as fractions of the frame (w and h above 0)`, textBoxesHint);
    }
    if (typeof textColor !== 'string' || !isHexColor(textColor)) throw new DataFileError(path, `${where} has no "textColor" of the form #rrggbb`, textBoxesHint);
    return { frame, box: { x: box['x'], y: box['y'], w: box['w'], h: box['h'] }, textColor };
  });
}

/** Reads and parses a text-boxes file. */
export function readTextBoxes(path: string): TextBox[] {
  return parseTextBoxes(readJsonFile(path), path);
}

/** The whole-pixel rectangle of a normalized box in a frame of the given size, at least 1x1 and inside the frame. */
export function pixelBox(box: NormalizedBox, width: number, height: number): PixelBox {
  const x = Math.min(width - 1, Math.round(box.x * width));
  const y = Math.min(height - 1, Math.round(box.y * height));
  const w = Math.max(1, Math.min(width - x, Math.round(box.w * width)));
  const h = Math.max(1, Math.min(height - y, Math.round(box.h * height)));
  return { x, y, w, h };
}

/** The crop + signalstats graph that prints the average luma of a rectangle of a still to a file; the RGB still is converted with the BT.709 matrix the delivery is tagged with (ADR 0008 decision 3), not ffmpeg's BT.601 default, so a coloured box measures the luma a player shows. */
export function boxLumaFilter(box: PixelBox, statsPath: string): string {
  return `crop=${box.w}:${box.h}:${box.x}:${box.y},${rgbToLumaConversion},signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=${filterPath(statsPath)}`;
}

/** The RGB-to-YUV step the measurements share: the BT.709 matrix, then yuv420p for signalstats. */
export const rgbToLumaConversion = 'scale=out_color_matrix=bt709,format=yuv420p';

interface BoxResult {
  readonly index: number;
  readonly box: TextBox;
  readonly ratio: number | null;
  readonly yavg: number | null;
  readonly reason: string;
}

async function measureBox(analysis: Analysis, index: number, box: TextBox, framePath: string | undefined): Promise<BoxResult> {
  if (framePath === undefined) return { index, box, ratio: null, yavg: null, reason: `frame ${box.frame} is beyond the end of the video` };
  const statsPath = join(analysis.workDir, `text-box-${index}.txt`);
  const pixels = pixelBox(box.box, analysis.probe.width, analysis.probe.height);
  await runAnalysis(analysis.runner, analysis.ffmpegPath, ['-i', framePath, '-vf', boxLumaFilter(pixels, statsPath), '-frames:v', '1'], 'ffmpeg signalstats', analysis.signal);
  const yavg = existsSync(statsPath) ? parseSignalstatsYavg(readFileSync(statsPath, 'utf8'))[0] : undefined;
  if (yavg === undefined) return { index, box, ratio: null, yavg: null, reason: 'signalstats printed no luma for the box' };
  const ratio = contrastRatio(relativeLuminanceOfHex(box.textColor), relativeLuminanceOfLuma(yavg));
  return { index, box, ratio, yavg, reason: '' };
}

function describeBox(result: BoxResult): string {
  const { box } = result;
  const where = `text box ${result.index} at frame ${box.frame} (x ${box.box.x}, y ${box.box.y}, ${box.box.w}x${box.box.h} of the frame)`;
  if (result.ratio === null || result.yavg === null) return `${where} could not be measured: ${result.reason}`;
  return `${where} has contrast ${round(result.ratio, 2)}:1 against text ${box.textColor} (box luma ${round(result.yavg, 1)} averaged with the text pixels, so the true ratio is at least this)`;
}

/** Extracts each named frame once, measures every box and judges the lowest ratio. */
export async function checkTextContrast(analysis: Analysis, boxes: readonly TextBox[]): Promise<Check> {
  if (boxes.length === 0) return makeCheck('text-contrast', { ok: true, measured: null, threshold: contrastThreshold, unit: 'ratio', detail: 'no text boxes given', frames: [] });
  try {
    const framePaths = new Map<number, string | undefined>();
    for (const frame of new Set(boxes.map((box) => box.frame))) {
      const framePath = join(analysis.workDir, `text-frame-${frame}.png`);
      const found = await extractFrame(analysis.runner, analysis.ffmpegPath, analysis.videoPath, frame, framePath, analysis.signal);
      framePaths.set(frame, found ? framePath : undefined);
    }
    const results: BoxResult[] = [];
    for (const [index, box] of boxes.entries()) results.push(await measureBox(analysis, index, box, framePaths.get(box.frame)));
    const failing = results.filter((result) => result.ratio === null || result.ratio < contrastThreshold);
    const measured = results.filter((result) => result.ratio !== null).map((result) => result.ratio ?? 0);
    const lowest = measured.length === 0 ? null : round(Math.min(...measured), 2);
    const worst = failing.sort((a, b) => (a.ratio ?? -1) - (b.ratio ?? -1))[0];
    const lowestResult = results.find((result) => result.ratio !== null && round(result.ratio, 2) === lowest);
    const detail = worst === undefined
      ? `lowest contrast ${lowest}:1 at frame ${lowestResult?.box.frame ?? 0}; all ${results.length} text box(es) at or above ${contrastThreshold}:1`
      : `${describeBox(worst)}${failing.length > 1 ? ` and ${failing.length - 1} more below ${contrastThreshold}:1` : ''}`;
    const frames = [...new Set(failing.map((result) => result.box.frame))].sort((a, b) => a - b);
    return makeCheck('text-contrast', { ok: worst === undefined, measured: lowest, threshold: contrastThreshold, unit: 'ratio', detail, frames });
  } catch (error: unknown) {
    return unmeasured('text-contrast', 'ratio', contrastThreshold, error);
  }
}
