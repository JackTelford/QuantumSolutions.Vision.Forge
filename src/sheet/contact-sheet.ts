/**
 * A contact sheet: labelled thumbnails of frames tiled into one PNG for
 * Claude to review. One ffmpeg run takes every frame as an input, scales
 * and labels each (drawtext), joins them (concat) and lays them out (tile).
 * The output width is columns * thumbWidth + (columns - 1) * padding +
 * 2 * margin; the height follows from the rows the same way. Every frame
 * must share one aspect ratio, because concat needs equal sizes.
 *
 * Labels always name a font file when one can be found: the Windows ffmpeg
 * build (gyan.dev 9.0.2) has no fontconfig configuration, and a graph with
 * two or more drawtext filters that rely on it crashes with an access
 * violation (one filter only warns). findSheetFont supplies the file.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { UsageError, VisionForgeError } from '../errors/vision-forge-error.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { filterPath, runFfmpeg } from '../tools/ffmpeg.ts';

/** One frame on the sheet. */
export interface SheetFrame {
  /** Absolute path of a PNG. */
  readonly path: string;
  /** The caption drawn in the frame's top-left corner, for example "s03 f0030". */
  readonly label: string;
}

/** What buildContactSheet needs; the optional fields take sheetDefaults. */
export interface ContactSheetRequest {
  readonly frames: readonly SheetFrame[];
  /** Thumbnails per row, default 4. */
  readonly columns?: number;
  /** Thumbnail width in pixels, default 480; the height keeps the aspect ratio (even). */
  readonly thumbWidth?: number;
  /** Pixels between thumbnails, default 6. */
  readonly padding?: number;
  /** Pixels around the sheet, default 12. */
  readonly margin?: number;
  /** Sheet background as "#rrggbb", default "#202020". */
  readonly background?: string;
  /** Absolute path of a TrueType font for the labels; when absent, the platform font findSheetFont returns, and drawtext's own default only when that is missing too. */
  readonly fontFile?: string;
  /** Absolute path of the PNG to write. */
  readonly output: string;
}

/** What buildContactSheet produced. */
export interface ContactSheetResult {
  readonly outputPath: string;
  /** Frames on the sheet. */
  readonly count: number;
  readonly columns: number;
  readonly rows: number;
}

/** The defaults for the optional request fields. */
export const sheetDefaults = { columns: 4, thumbWidth: 480, padding: 6, margin: 12, background: '#202020' } as const;

/**
 * Escapes a label for `drawtext=text=...` inside a filter graph. ffmpeg reads
 * the value three times: the graph parser (terminators `[ ] , ;`, with `\`
 * and `'` special), the option parser (terminator `:`, the same escapes) and
 * drawtext's own expansion, where `\x` yields x and `%{` starts a function.
 * So the label is escaped for drawtext first (a backslash before `\` and
 * `%`), then backslash-escaped twice for the two parsers; that set covers
 * backslash, apostrophe, colon, comma, semicolon, brackets, equals and
 * space (so leading and trailing spaces survive the parsers' trimming).
 * Verified pixel-for-pixel against `textfile=` with `expansion=none`.
 */
export function escapeDrawtextLabel(label: string): string {
  const forDrawtext = label.replace(/\\/g, '\\\\').replace(/%/g, '\\%');
  const parserLevel = (text: string): string => text.replace(/[\\':,;[\] =]/g, (character) => `\\${character}`);
  return parserLevel(parserLevel(forDrawtext));
}

/**
 * The first font file that exists among the platform's usual ones: Segoe UI
 * on Windows, Arial or Helvetica on macOS, DejaVu Sans on Linux. Undefined
 * when none exists; drawtext then falls back to fontconfig, which Windows
 * builds may lack, so callers prefer the explicit file.
 */
export function findSheetFont(platform: NodeJS.Platform = process.platform, env: Readonly<Record<string, string | undefined>> = process.env, exists: (path: string) => boolean = existsSync): string | undefined {
  const candidates = platform === 'win32'
    ? [win32.join(env['WINDIR'] ?? 'C:\\Windows', 'Fonts', 'segoeui.ttf')]
    : platform === 'darwin'
      ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']
      : [posix.join('/usr/share/fonts/truetype/dejavu', 'DejaVuSans.ttf')];
  return candidates.find((candidate) => exists(candidate));
}

/** Rows needed for `count` frames in `columns` columns. */
export function sheetRows(count: number, columns: number): number {
  return Math.max(1, Math.ceil(count / columns));
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) throw new UsageError(`${name} must be a whole number of 1 or more, got ${resolved}.`, `Pass ${name} <integer>.`);
  return resolved;
}

/** How the sheet finds a font when the request names none; injectable for tests. */
export type FontLookup = () => string | undefined;

/** The request with every default filled in (the font from `findFont` when none is given) and its numbers checked. */
export function resolveSheetRequest(request: ContactSheetRequest, findFont: FontLookup = findSheetFont): Required<Omit<ContactSheetRequest, 'fontFile'>> & { readonly fontFile: string | undefined; readonly rows: number } {
  if (request.frames.length === 0) throw new VisionForgeError({ code: 'sheet-no-frames', message: 'The contact sheet has no frames.', hint: 'Pass a JSON list of { path, label } entries or a directory that holds PNG files.' });
  const background = request.background ?? sheetDefaults.background;
  if (!/^#[0-9a-fA-F]{6}$/.test(background)) throw new UsageError(`The sheet background must be #rrggbb, got "${background}".`, 'Pass a six-digit hex colour such as #202020.');
  const columns = positiveInteger(request.columns, sheetDefaults.columns, '--columns');
  return {
    frames: request.frames,
    columns,
    thumbWidth: positiveInteger(request.thumbWidth, sheetDefaults.thumbWidth, '--thumb-width'),
    padding: request.padding ?? sheetDefaults.padding,
    margin: request.margin ?? sheetDefaults.margin,
    background,
    fontFile: request.fontFile ?? findFont(),
    output: request.output,
    rows: sheetRows(request.frames.length, columns),
  };
}

/** The filter graph: one scale + drawtext chain per input, then concat and tile. */
export function contactSheetGraph(request: ContactSheetRequest, findFont: FontLookup = findSheetFont): string {
  const resolved = resolveSheetRequest(request, findFont);
  const font = resolved.fontFile === undefined ? '' : `:fontfile=${filterPath(resolved.fontFile)}`;
  const chains = resolved.frames.map((frame, index) => `[${index}:v]scale=${resolved.thumbWidth}:-2,drawtext=text=${escapeDrawtextLabel(frame.label)}:x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=0x00000088${font}[t${index}]`);
  const inputs = resolved.frames.map((_frame, index) => `[t${index}]`).join('');
  const layout = `${inputs}concat=n=${resolved.frames.length}:v=1:a=0,tile=${resolved.columns}x${resolved.rows}:padding=${resolved.padding}:margin=${resolved.margin}:color=0x${resolved.background.slice(1)}`;
  return [...chains, layout].join(';');
}

/** The full ffmpeg argument list for a request. */
export function contactSheetArgs(request: ContactSheetRequest, findFont: FontLookup = findSheetFont): readonly string[] {
  return ['-y', ...request.frames.flatMap((frame) => ['-i', frame.path]), '-filter_complex', contactSheetGraph(request, findFont), '-frames:v', '1', request.output];
}

/** Renders the sheet with one ffmpeg run and returns where it went and how it was laid out. */
export async function buildContactSheet(runner: ProcessRunner, ffmpegPath: string, request: ContactSheetRequest, signal: AbortSignal, findFont: FontLookup = findSheetFont): Promise<ContactSheetResult> {
  const resolved = resolveSheetRequest(request, findFont);
  mkdirSync(dirname(resolved.output), { recursive: true });
  await runFfmpeg(runner, ffmpegPath, contactSheetArgs(request, findFont), { label: 'ffmpeg contact sheet', failureHint: 'Check that every frame is a PNG of the same aspect ratio; run the command again with --verbose to see the full ffmpeg output.' }, signal);
  return { outputPath: resolved.output, count: resolved.frames.length, columns: resolved.columns, rows: resolved.rows };
}
