/**
 * Reads a delivery back with ffprobe: counted frames, frame rate, size,
 * sample aspect ratio, pixel format and colour matrix, so the assemble
 * command can verify what it wrote against the plan.
 */
import { ProcessTimeoutError } from '../errors/vision-forge-error.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';
import { DeliveryProbeTimeoutError } from './assemble-error.ts';

/** What ffprobe reported about the first video stream. */
export interface ProbedVideo {
  /** Frames actually decoded (`-count_frames`). */
  readonly frames: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly pixelFormat: string;
  /** The colour matrix tag, for example "bt709", or "unknown". */
  readonly colorSpace: string;
  /** The sample aspect ratio as ffprobe prints it, for example "1:1" ("N/A" when the stream carries none), or "unknown". */
  readonly sampleAspectRatio: string;
}

/** The ffprobe arguments that produce the key=value lines probeVideo parses. */
export function probeArguments(path: string): readonly string[] {
  return ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,r_frame_rate,width,height,sample_aspect_ratio,pix_fmt,color_space', '-of', 'default=noprint_wrappers=1', path];
}

/** Parses ffprobe's `default=noprint_wrappers=1` output; missing numbers become NaN, missing strings "unknown". */
export function parseProbeOutput(stdout: string): ProbedVideo {
  const values = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const equals = line.indexOf('=');
    if (equals > 0) values.set(line.slice(0, equals).trim(), line.slice(equals + 1).trim());
  }
  const rate = values.get('r_frame_rate') ?? '';
  const [numerator, denominator] = rate.split('/').map((part) => Number.parseInt(part, 10));
  const fps = numerator !== undefined && denominator !== undefined && denominator !== 0 ? numerator / denominator : Number.NaN;
  return {
    frames: Number.parseInt(values.get('nb_read_frames') ?? '', 10),
    fps,
    width: Number.parseInt(values.get('width') ?? '', 10),
    height: Number.parseInt(values.get('height') ?? '', 10),
    pixelFormat: values.get('pix_fmt') ?? 'unknown',
    colorSpace: values.get('color_space') ?? 'unknown',
    sampleAspectRatio: values.get('sample_aspect_ratio') ?? 'unknown',
  };
}

/** The time budget for counting a delivery's frames: 100 ms per expected frame, never under two minutes. */
export function probeTimeoutMs(durationFrames: number): number {
  const perFrame = Number.isFinite(durationFrames) && durationFrames > 0 ? durationFrames * 100 : 0;
  return Math.max(120_000, perFrame);
}

/**
 * Runs ffprobe on a file and parses the first video stream. `-count_frames`
 * decodes every frame, so the budget grows with the plan's `durationFrames`;
 * running out of it raises DeliveryProbeTimeoutError, whose hint says the
 * delivery itself was written.
 */
export async function probeVideo(runner: ProcessRunner, ffprobePath: string, path: string, durationFrames: number, signal: AbortSignal): Promise<ProbedVideo> {
  const timeoutMs = probeTimeoutMs(durationFrames);
  try {
    const result = await runFfmpeg(runner, ffprobePath, probeArguments(path), { label: 'ffprobe', timeoutMs, failureHint: 'The delivery could not be read back; it may be truncated. Run assemble again.' }, signal);
    return parseProbeOutput(result.stdout);
  } catch (error: unknown) {
    if (error instanceof ProcessTimeoutError) throw new DeliveryProbeTimeoutError(path, timeoutMs, error);
    throw error;
  }
}
