/**
 * SubRip captions from narration timings: one cue per sentence, times in
 * `HH:MM:SS,mmm`, blank-line separated, as the assembler's sidecar and
 * ffmpeg's `subtitles` filter expect. Pure.
 */

/** One caption. */
export interface SrtCue {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

/** Seconds as an SRT timestamp, `HH:MM:SS,mmm`, rounded to the millisecond. */
export function formatSrtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError(`An SRT time must be a non-negative number of seconds, not ${String(seconds)}.`);
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(hours)}:${two(minutes)}:${two(secs)},${String(ms).padStart(3, '0')}`;
}

/** The SRT document of the cues, numbered from 1, LF line ends, ending with one blank line. */
export function formatSrt(cues: readonly SrtCue[]): string {
  return cues
    .map((cue, index) => {
      if (cue.endSeconds < cue.startSeconds) throw new RangeError(`Cue ${String(index + 1)} ends before it starts.`);
      return `${String(index + 1)}\n${formatSrtTime(cue.startSeconds)} --> ${formatSrtTime(cue.endSeconds)}\n${cue.text.replace(/\s+/g, ' ').trim()}\n`;
    })
    .join('\n');
}
