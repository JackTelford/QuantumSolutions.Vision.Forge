/**
 * Grades one raw frame into the still the gate judges and the reviewer
 * sees: the look's grade baked into a .cube next to the still and applied
 * by lut3d in 16-bit RGB, then the vignette, then back to 8-bit RGB. The
 * chain is the delivery's (src/finishing/finishing-chain.ts) without the
 * grain and without the BT.709 conversion: ADR 0006 decision 7 compares
 * the approved still with the rendered frame before grain, and a PNG stays
 * RGB. The still is therefore graded like the delivery but clean.
 *
 * A three or blender shot with text carries its words on a text plate of
 * its own (ADR 0008 decision 4): that PNG, captured with alpha, is laid
 * over the graded picture after the grade, exactly as the assembly lays it
 * over every frame, so the gate's contrast and composition checks see the
 * composite the delivery will show.
 */
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { vignetteFilter } from '../finishing/finishing-chain.ts';
import { ensureDirectory } from '../fs/paths.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { Grade, LookBible } from '../shared/contracts/look-bible.ts';
import { generateCube } from '../shared/grade/grade.ts';
import { filterPath, runFfmpeg } from '../tools/ffmpeg.ts';

/** The .cube written beside a still: the still's path with `.cube` in place of `.png`. */
export function cubePathBeside(finishedPng: string): string {
  return finishedPng.replace(/\.png$/i, '') + '.cube';
}

/** The overlay step that lays a text plate over a picture: ffmpeg picks the working format from the two inputs, and rgb24 follows so the PNG encoder receives the same format with or without a plate. */
export const textOverlayFilter = 'overlay=format=auto,format=rgb24';

/**
 * The filter steps of a still, in order: 16-bit RGB, the LUT (tetrahedral),
 * then 8-bit RGB and the vignette when the grade has one, and 8-bit RGB at
 * the end so the PNG encoder receives plain rgb24. No grain, by design.
 */
export function stillFinishingFilters(grade: Grade, cubePath: string): readonly string[] {
  const steps: string[] = ['format=gbrp16le', `lut3d=file=${filterPath(cubePath)}:interp=tetrahedral`];
  const vignette = vignetteFilter(grade.vignetteAmount);
  // ffmpeg 9's vignette accepts rgb24 but not gbrp16le, so the chain drops to 8 bits before it.
  if (vignette !== undefined) steps.push('format=rgb24', vignette);
  steps.push('format=rgb24');
  return steps;
}

/** The filter graph of a still with a text plate: input 0 (the raw picture) graded into `[picture]`, input 1 (the text plate) laid over it into `[still]`. */
export function stillCompositeGraph(filters: readonly string[]): string {
  return `[0:v]${filters.join(',')}[picture];[picture][1:v]${textOverlayFilter}[still]`;
}

/** The ffmpeg arguments (after -hide_banner) that write one graded PNG from one raw PNG, with the text plate laid over the graded picture when one is given. */
export function finishStillArgs(rawPng: string, finishedPng: string, filters: readonly string[], textPng?: string): readonly string[] {
  // -update 1 tells the image2 muxer the output is a single file, not a sequence pattern.
  const tail = ['-frames:v', '1', '-update', '1', finishedPng];
  if (textPng === undefined) return ['-nostats', '-y', '-i', rawPng, '-vf', filters.join(','), ...tail];
  return ['-nostats', '-y', '-i', rawPng, '-i', textPng, '-filter_complex', stillCompositeGraph(filters), '-map', '[still]', ...tail];
}

/** Writes the look's .cube beside the still, then grades the raw PNG into the finished PNG with ffmpeg, laying the text plate over the graded picture when the shot has one. */
export async function finishStill(runner: ProcessRunner, ffmpegPath: string, rawPng: string, finishedPng: string, look: LookBible, signal: AbortSignal, textPng?: string): Promise<void> {
  ensureDirectory(dirname(finishedPng));
  const cubePath = cubePathBeside(finishedPng);
  writeFileSync(cubePath, generateCube(look.grade), 'utf8');
  await runFfmpeg(runner, ffmpegPath, finishStillArgs(rawPng, finishedPng, stillFinishingFilters(look.grade, cubePath), textPng), {
    label: 'ffmpeg still finishing',
    failureHint: `Check that ${rawPng}${textPng === undefined ? ' is a readable PNG' : ` and ${textPng} are readable PNGs`}; run the command again with --verbose to see the full ffmpeg output.`,
  }, signal);
}
