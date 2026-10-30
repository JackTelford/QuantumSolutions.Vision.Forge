/**
 * `sheet`: tiles labelled frame thumbnails into one PNG for review.
 *
 * `--frames <source>` is a JSON list of `{ path, label }` entries or a
 * directory whose PNG files are taken in name order; `--video <file>
 * --every <n>` takes every nth frame of a delivery instead (extracted with
 * ffmpeg into `<out>/sheets/<video name>-frames/`, labelled by frame
 * number), which is how a finished piece is looked at frame by frame. `--output <png>`
 * names the sheet (default `<out>/sheets/<source name>.png`); `--columns`
 * (4) and `--thumb-width` (480) set the layout. Labels use the platform's
 * usual font file when one exists.
 */
import { existsSync, rmSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { DataFileError, ToolMissingError, UsageError, VisionForgeError } from '../../errors/vision-forge-error.ts';
import { ensureDirectory } from '../../fs/paths.ts';
import { extractEveryNth } from '../../qa/frame-extract.ts';
import { buildContactSheet, findSheetFont } from '../../sheet/contact-sheet.ts';
import { readFrameList } from '../../sheet/frame-list.ts';
import type { SheetFrame } from '../../sheet/contact-sheet.ts';
import { requireFfmpeg } from '../../tools/ffmpeg.ts';
import { fullBuildAdvice, missingSheetFilters } from '../../tools/ffmpeg-info.ts';
import { readToolsManifest } from '../../tools/tools-manifest.ts';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';

/** Shape of the sheet payload. */
export interface SheetData {
  /** Absolute path of the PNG that was written. */
  readonly outputPath: string;
  /** Frames on the sheet. */
  readonly count: number;
  readonly columns: number;
  readonly rows: number;
}

/**
 * Throws ToolMissingError when tools.json under the data directory records an
 * ffmpeg without drawtext or tile, so the user reads the install advice
 * instead of an ffmpeg parse error. Without a readable manifest (doctor not
 * run yet, or a stale file) nothing is checked and ffmpeg itself decides.
 */
export function assertSheetFilters(dataDir: string): void {
  let filters: readonly string[] | undefined;
  try {
    filters = readToolsManifest(dataDir).programs.ffmpeg?.filters;
  } catch (error: unknown) {
    if (error instanceof VisionForgeError) return;
    throw error;
  }
  if (filters === undefined) return;
  const gaps = missingSheetFilters(filters);
  if (gaps.length > 0) throw new ToolMissingError(`the ffmpeg filter${gaps.length === 1 ? '' : 's'} ${gaps.join(' and ')}, which contact sheets need,`, `${fullBuildAdvice[0]?.toUpperCase() ?? ''}${fullBuildAdvice.slice(1)}, then run doctor again.`);
}

/** Every how many frames of a delivery the sheet takes one when --every is absent: half a second at 30 fps. */
export const defaultEvery = 15;

/** Where a delivery's extracted frames go: <out>/sheets/<video name>-frames/, emptied first. */
export function videoFramesDir(outDir: string, videoPath: string): string {
  return join(outDir, 'sheets', `${basename(videoPath, extname(videoPath))}-frames`);
}

/** Every nth frame of the delivery as sheet frames labelled by frame number. */
async function videoFrames(context: CommandContext, ffmpegPath: string, videoPath: string, every: number): Promise<SheetFrame[]> {
  if (!existsSync(videoPath)) throw new DataFileError(videoPath, 'the file does not exist', 'Pass the delivery assemble wrote (its path is in the job\'s deliverablePath).');
  if (!Number.isInteger(every) || every < 1) throw new UsageError(`--every must be a whole number of frames, 1 or more, not ${String(every)}.`, 'For example --every 15 takes one frame every half second at 30 fps.');
  const dir = videoFramesDir(context.outDir, videoPath);
  rmSync(dir, { recursive: true, force: true });
  ensureDirectory(dir);
  const extracted = await extractEveryNth(context.runner, ffmpegPath, videoPath, every, dir, context.signal);
  if (extracted.length === 0) throw new DataFileError(videoPath, 'ffmpeg extracted no frame from it', 'Check that the file decodes with ffmpeg.');
  context.log.info(`sheet: ${extracted.length} frames of ${basename(videoPath)}, one every ${every}, under ${dir}`);
  return extracted.map((entry) => ({ path: entry.path, label: `frame ${entry.frame}` }));
}

/** Where the sheet goes when --output is absent: <out>/sheets/<source name>.png. */
export function defaultSheetPath(outDir: string, source: string): string {
  return join(outDir, 'sheets', `${basename(source, extname(source))}.png`);
}

/** The sheet command. */
export const command: Command = {
  name: 'sheet',
  summary: 'Tile labelled frame thumbnails into one PNG contact sheet.',
  options: { strings: ['frames', 'output', 'columns', 'thumb-width', 'video', 'every'], flags: [] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const video = args.string('video');
    const framesOption = args.string('frames');
    if (video !== undefined && framesOption !== undefined) throw new UsageError('--video does not go with --frames.', 'Pass --frames for PNGs you already have, or --video with --every for a delivery.');
    const ffmpegPath = requireFfmpeg();
    const source = resolve(context.cwd, video ?? args.requireString('frames', 'a JSON list of { path, label } entries or a directory of PNG frames, or --video <file> --every <n>'));
    const frames = video === undefined ? readFrameList(source) : await videoFrames(context, ffmpegPath, source, args.number('every') ?? defaultEvery);
    const outputOption = args.string('output');
    const output = outputOption === undefined ? defaultSheetPath(context.outDir, source) : resolve(context.cwd, outputOption);
    const columns = args.number('columns');
    const thumbWidth = args.number('thumb-width');
    const fontFile = findSheetFont();
    assertSheetFilters(context.dataDir);
    const result = await buildContactSheet(context.runner, ffmpegPath, {
      frames,
      output,
      ...(columns === undefined ? {} : { columns }),
      ...(thumbWidth === undefined ? {} : { thumbWidth }),
      ...(fontFile === undefined ? {} : { fontFile }),
    }, context.signal);
    context.log.info(`sheet: wrote ${result.outputPath} (${result.count} frames, ${result.columns}x${result.rows})`);
    const data: SheetData = { outputPath: result.outputPath, count: result.count, columns: result.columns, rows: result.rows };
    return { data, artifacts: [result.outputPath] };
  },
};
