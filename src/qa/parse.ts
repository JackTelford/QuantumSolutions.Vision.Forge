/**
 * Parsers for the text ffmpeg's analysis filters print. Each one takes the
 * raw standard error or side file and returns numbers; nothing here runs a
 * program. The formats were recorded against ffmpeg 9.0.2 in
 * docs/evidence/m0/p6-ffmpeg.md.
 */

/** A span of a stream in seconds, end exclusive. */
export interface TimeSegment {
  readonly start: number;
  readonly end: number;
}

/** What ebur128 prints after "Summary:" at the end of a stream. */
export interface LoudnessSummary {
  /** Integrated loudness in LUFS, for example -16.0. */
  readonly integrated: number;
  /** True peak in dBTP (ebur128 labels it dBFS), for example -1.2; negative infinity for digital silence. */
  readonly truePeak: number;
}

/**
 * Black segments from blackdetect's log lines, for example
 * `[Parsed_blackdetect_0 @ ...] black_start:1 black_end:1.5 black_duration:0.5`.
 */
export function parseBlackdetect(stderr: string): TimeSegment[] {
  const segments: TimeSegment[] = [];
  const pattern = /black_start:([0-9.]+)\s+black_end:([0-9.]+)/g;
  for (const match of stderr.matchAll(pattern)) {
    segments.push({ start: Number(match[1]), end: Number(match[2]) });
  }
  return segments;
}

/**
 * Frozen segments from freezedetect's log lines (`lavfi.freezedetect.freeze_start: 1`
 * then `freeze_end: 1.5`). A freeze that runs to the end of the stream has
 * a start without an end; it ends at `streamEnd`.
 */
export function parseFreezedetect(stderr: string, streamEnd: number): TimeSegment[] {
  const segments: TimeSegment[] = [];
  let openStart: number | undefined;
  const pattern = /lavfi\.freezedetect\.freeze_(start|end):\s*([0-9.]+)/g;
  for (const match of stderr.matchAll(pattern)) {
    const value = Number(match[2]);
    if (match[1] === 'start') {
      if (openStart !== undefined) segments.push({ start: openStart, end: streamEnd });
      openStart = value;
    } else if (openStart !== undefined) {
      segments.push({ start: openStart, end: value });
      openStart = undefined;
    }
  }
  if (openStart !== undefined) segments.push({ start: openStart, end: streamEnd });
  return segments;
}

/**
 * Per-frame SSIM from the ssim filter's stats file, one line per frame such as
 * `n:31 Y:0.254471 U:0.457107 V:0.415623 All:0.315102 (1.643742)`. Frame
 * numbers in the file start at 1; the result is indexed from 0.
 */
export function parseSsimStats(text: string): number[] {
  const values: number[] = [];
  const pattern = /^n:(\d+)\s.*\bAll:([0-9.]+)/gm;
  for (const match of text.matchAll(pattern)) {
    const index = Number(match[1]) - 1;
    if (index >= 0) values[index] = Number(match[2]);
  }
  return values;
}

/**
 * Per-frame luma averages from the metadata filter's print file: a `frame:N`
 * line followed by `lavfi.signalstats.YAVG=120.818`. Indexed by frame number.
 */
export function parseSignalstatsYavg(text: string): number[] {
  const values: number[] = [];
  let frame = -1;
  for (const line of text.split(/\r?\n/)) {
    const header = /^frame:(\d+)/.exec(line);
    if (header !== null) {
      frame = Number(header[1]);
      continue;
    }
    const value = /^lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(line.trim());
    if (value !== null && frame >= 0) values[frame] = Number(value[1]);
  }
  return values;
}

/**
 * The integrated loudness and true peak from ebur128's end-of-stream summary.
 * The filter also prints per-frame lines with the same labels, so only the
 * text after the last "Summary:" is read. Undefined when there is no summary.
 */
export function parseEbur128Summary(stderr: string): LoudnessSummary | undefined {
  const summaryStart = stderr.lastIndexOf('Summary:');
  if (summaryStart < 0) return undefined;
  const summary = stderr.slice(summaryStart);
  const integrated = /\bI:\s+(-?[0-9.]+|-inf)\s+LUFS/.exec(summary);
  const peak = /\bPeak:\s+(-?[0-9.]+|-inf)\s+dBFS/.exec(summary);
  if (integrated === null) return undefined;
  return { integrated: parseLevel(integrated[1]), truePeak: peak === null ? Number.NEGATIVE_INFINITY : parseLevel(peak[1]) };
}

function parseLevel(text: string | undefined): number {
  if (text === undefined || text === '-inf') return Number.NEGATIVE_INFINITY;
  return Number(text);
}

/**
 * The overall SSIM from the ssim filter's summary line on standard error, for
 * example `[Parsed_ssim_3 @ ...] SSIM R:1.000000 (inf) ... All:1.000000 (inf)`.
 * Undefined when the filter compared nothing.
 */
export function parseSsimSummary(stderr: string): number | undefined {
  const match = /SSIM [^\n]*\bAll:([0-9.]+)/.exec(stderr);
  return match === null ? undefined : Number(match[1]);
}

/**
 * The average PSNR in dB from ffmpeg's `psnr` summary line, for example
 * `[Parsed_psnr_0 @ ...] PSNR r:inf g:inf b:99.256854 average:104.028066 min:... max:...`;
 * Infinity for identical frames, undefined when the filter compared nothing.
 */
export function parsePsnrSummary(stderr: string): number | undefined {
  const match = /PSNR [^\n]*\baverage:(inf|[0-9.]+)/.exec(stderr);
  if (match === null) return undefined;
  return match[1] === 'inf' ? Number.POSITIVE_INFINITY : Number(match[1]);
}
