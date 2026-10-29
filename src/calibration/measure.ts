/**
 * Measures a rendered calibration frame (src/shared/calibration/scene.ts)
 * the way the delivery is measured: every patch's limited-range YAVG
 * through the same crop + signalstats filter the still gate and the QA
 * text-contrast check use, against the patch's expectation and tolerance;
 * and every saturated swatch's mean RGB (the box scaled to one pixel with
 * an area average) turned into a hue and compared with the swatch's own
 * hex. Every patch also reports its mean RGB, because a luma alone cannot
 * tell a neutral gray from a warm one: a lane whose lights carry a colour
 * temperature tints its neutral patches, and the gray card's YAVG can sit
 * on target while the channels do not. ADR 0008 decision 2: the gray
 * card's number sets a lane's light scalar, the rest is reported.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirectory } from '../fs/paths.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { runAnalysis } from '../qa/check.ts';
import { parseSignalstatsYavg } from '../qa/parse.ts';
import { boxLumaFilter, pixelBox } from '../qa/text-contrast.ts';
import type { PixelBox } from '../qa/text-contrast.ts';
import { calibrationScene } from '../shared/calibration/scene.ts';
import type { CalibrationElement, CalibrationPatch } from '../shared/calibration/scene.ts';
import { hexToRgb255, hueDegrees, hueDeltaDegrees, saturation } from '../shared/color/hue.ts';
import type { Rgb255 } from '../shared/color/hue.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';

/** What measuring a frame needs. */
export interface MeasureOptions {
  readonly runner: ProcessRunner;
  readonly ffmpegPath: string;
  /** The rendered frame, a PNG of width x height. */
  readonly png: string;
  readonly width: number;
  readonly height: number;
  /** Scratch folder for the signalstats side files and the pixel dumps; created when missing, the caller removes it. */
  readonly workDir: string;
  readonly signal: AbortSignal;
}

/** One patch's luma against the scene's expectation, with its mean colour. */
export interface PatchMeasurement {
  readonly id: string;
  readonly hex: string;
  readonly expectedYavg: number;
  readonly tolerance: number;
  /** The YAVG signalstats read inside the box; null when it printed none. */
  readonly measuredYavg: number | null;
  /** measured minus expected; null when unmeasured. */
  readonly delta: number | null;
  /** True when the delta's magnitude is within the tolerance. */
  readonly ok: boolean;
  /** The mean colour of the box, 0 to 255 per channel: equal channels on a neutral patch, a spread on a tinted one. */
  readonly meanRgb: Rgb255;
}

/** One saturated swatch's mean colour and how far its hue turned from the swatch's hex. */
export interface SwatchHueMeasurement {
  readonly id: string;
  readonly hex: string;
  readonly expectedHueDeg: number;
  /** The mean colour of the box, 0 to 255 per channel. */
  readonly rgb: Rgb255;
  readonly measuredHueDeg: number;
  /** The shortest signed turn from the expected hue to the measured one, in degrees. */
  readonly deltaDeg: number;
  /** The HSV saturation of the mean colour, 0 to 1: how much of the swatch's chroma the lane kept. */
  readonly saturation: number;
}

/** The patches of the calibration scene, in scene order. */
export function calibrationPatches(): readonly CalibrationPatch[] {
  // Widened from the scene's literal types so the predicate can name the interface.
  const elements: readonly CalibrationElement[] = calibrationScene.elements;
  return elements.filter((element): element is CalibrationPatch => element.kind === 'patch');
}

/** The six saturated swatches: the patches defined by an sRGB value rather than a neutral reflectance. */
export function saturatedSwatches(): readonly CalibrationPatch[] {
  return calibrationPatches().filter((patch) => patch.linearReflectance === null);
}

/** The ffmpeg arguments (after -hide_banner) that write the mean colour of a box as three raw rgb24 bytes: the box cropped, area-averaged to one pixel. */
export function meanRgbArgs(png: string, box: PixelBox, outFile: string): readonly string[] {
  // flags=area is a true box average; the default bicubic scaler samples a few taps and would miss most of a large box.
  return ['-nostats', '-y', '-i', png, '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y},scale=1:1:flags=area,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', outFile];
}

/** The colour in a three-byte rgb24 dump; a RangeError names a file of another length. */
export function parseRgb24Pixel(bytes: Uint8Array): Rgb255 {
  if (bytes.length !== 3) throw new RangeError(`An rgb24 pixel dump holds 3 bytes, not ${String(bytes.length)}.`);
  return { r: bytes[0] ?? 0, g: bytes[1] ?? 0, b: bytes[2] ?? 0 };
}

/** The pixel box of a patch in a frame of the measured size. */
function patchBox(patch: CalibrationPatch, options: MeasureOptions): PixelBox {
  return pixelBox(patch.box, options.width, options.height);
}

/** The average luma inside a box through the gate's filter; undefined when signalstats printed none. */
async function measureBoxYavg(options: MeasureOptions, box: PixelBox, statsPath: string): Promise<number | undefined> {
  await runAnalysis(options.runner, options.ffmpegPath, ['-i', options.png, '-vf', boxLumaFilter(box, statsPath), '-frames:v', '1'], 'ffmpeg signalstats', options.signal);
  if (!existsSync(statsPath)) return undefined;
  return parseSignalstatsYavg(readFileSync(statsPath, 'utf8'))[0];
}

/** Measures every patch of the calibration scene in the frame, in scene order: the luma through the gate's filter and the mean colour through the area scaler, one ffmpeg run each. */
export async function measurePatches(options: MeasureOptions): Promise<readonly PatchMeasurement[]> {
  ensureDirectory(options.workDir);
  const measurements: PatchMeasurement[] = [];
  for (const patch of calibrationPatches()) {
    const box = patchBox(patch, options);
    const yavg = await measureBoxYavg(options, box, join(options.workDir, `patch-${patch.id}.txt`));
    const meanRgb = await measureMeanRgb(options, box, join(options.workDir, `patch-${patch.id}.rgb`));
    const delta = yavg === undefined ? null : yavg - patch.expectedYavg;
    measurements.push({ id: patch.id, hex: patch.hex, expectedYavg: patch.expectedYavg, tolerance: patch.tolerance, measuredYavg: yavg ?? null, delta, ok: delta !== null && Math.abs(delta) <= patch.tolerance, meanRgb });
  }
  return measurements;
}

/** The mean colour of a box of the frame, read through ffmpeg. */
export async function measureMeanRgb(options: MeasureOptions, box: PixelBox, outFile: string): Promise<Rgb255> {
  await runFfmpeg(options.runner, options.ffmpegPath, meanRgbArgs(options.png, box, outFile), {
    label: 'ffmpeg mean colour',
    failureHint: `Check that ${options.png} is a readable PNG; run the command again with --verbose to see the full ffmpeg output.`,
  }, options.signal);
  return parseRgb24Pixel(readFileSync(outFile));
}

/** Measures the mean colour and the hue turn of every saturated swatch in the frame. */
export async function measureSwatchHues(options: MeasureOptions): Promise<readonly SwatchHueMeasurement[]> {
  ensureDirectory(options.workDir);
  const measurements: SwatchHueMeasurement[] = [];
  for (const swatch of saturatedSwatches()) {
    const rgb = await measureMeanRgb(options, patchBox(swatch, options), join(options.workDir, `swatch-${swatch.id}.rgb`));
    const expectedHueDeg = hueDegrees(hexToRgb255(swatch.hex));
    const measuredHueDeg = hueDegrees(rgb);
    measurements.push({ id: swatch.id, hex: swatch.hex, expectedHueDeg, rgb, measuredHueDeg, deltaDeg: hueDeltaDegrees(expectedHueDeg, measuredHueDeg), saturation: saturation(rgb) });
  }
  return measurements;
}
