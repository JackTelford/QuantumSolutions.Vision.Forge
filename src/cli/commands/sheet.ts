/**
 * `sheet`: tiles labelled frame thumbnails into one PNG for review.
 *
 * `--frames <source>` is a JSON list of `{ path, label }` entries or a
 * directory whose PNG files are taken in name order. `--output <png>`
 * names the sheet (default `<out>/sheets/<source name>.png`); `--columns`
 * (4) and `--thumb-width` (480) set the layout. Labels use the platform's
 * usual font file when one exists.
 */
import { basename, extname, join, resolve } from 'node:path';
import { ToolMissingError, VisionForgeError } from '../../errors/vision-forge-error.ts';
import { buildContactSheet, findSheetFont } from '../../sheet/contact-sheet.ts';
import { readFrameList } from '../../sheet/frame-list.ts';
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

/** Where the sheet goes when --output is absent: <out>/sheets/<source name>.png. */
export function defaultSheetPath(outDir: string, source: string): string {
  return join(outDir, 'sheets', `${basename(source, extname(source))}.png`);
}

/** The sheet command. */
export const command: Command = {
  name: 'sheet',
  summary: 'Tile labelled frame thumbnails into one PNG contact sheet.',
  options: { strings: ['frames', 'output', 'columns', 'thumb-width'], flags: [] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const source = resolve(context.cwd, args.requireString('frames', 'a JSON list of { path, label } entries or a directory of PNG frames'));
    const frames = readFrameList(source);
    const outputOption = args.string('output');
    const output = outputOption === undefined ? defaultSheetPath(context.outDir, source) : resolve(context.cwd, outputOption);
    const columns = args.number('columns');
    const thumbWidth = args.number('thumb-width');
    const fontFile = findSheetFont();
    assertSheetFilters(context.dataDir);
    const ffmpegPath = requireFfmpeg();
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
