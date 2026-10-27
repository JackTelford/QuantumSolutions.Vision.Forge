/**
 * What ffprobe says about a file: the first video stream's geometry, rate,
 * decoded frame count and colour tags, and whether an audio stream exists.
 * One ffprobe run per question; the JSON is parsed here so that the checks
 * never see program output.
 */
import { DataFileError } from '../errors/vision-forge-error.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { isJsonObject } from '../schema/schema-registry.ts';
import type { JsonObject } from '../schema/schema-registry.ts';
import { runFfmpeg } from '../tools/ffmpeg.ts';

/** The first video stream of a file. */
export interface VideoProbe {
  /** Width in pixels, for example 1920. */
  readonly width: number;
  /** Height in pixels, for example 1080. */
  readonly height: number;
  /** Frames per second from r_frame_rate, for example 30 or 29.97. */
  readonly fps: number;
  /** Frames actually decoded (nb_read_frames), for example 105; the length in seconds is frameCount / fps. */
  readonly frameCount: number;
  /** Codec name, for example "h264". */
  readonly codec: string;
  /** Pixel format, for example "yuv420p". */
  readonly pixFmt: string;
  /** Colour matrix tag, for example "bt709", or "unknown" when the file carries none. */
  readonly colorSpace: string;
  /** "tv", "pc" or "unknown". */
  readonly colorRange: string;
}

/** The first audio stream of a file. */
export interface AudioProbe {
  /** Codec name, for example "aac" or "pcm_s16le". */
  readonly codec: string;
  /** Samples per second, for example 48000. */
  readonly sampleRate: number;
  /** Channel count, for example 2. */
  readonly channels: number;
}

/** The ffprobe arguments that produce the video entries as JSON. */
export function videoProbeArgs(path: string): readonly string[] {
  return ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames,codec_name,pix_fmt,color_space,color_range', '-of', 'json', path];
}

/** The ffprobe arguments that produce the audio entries as JSON. */
export function audioProbeArgs(path: string): readonly string[] {
  return ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', path];
}

/** Parses an ffprobe rational such as "30/1" or "30000/1001" into frames per second; NaN when malformed. */
export function parseFrameRate(text: string): number {
  const [first, second] = text.split('/');
  const numerator = Number(first);
  const denominator = second === undefined ? 1 : Number(second);
  if (first === undefined || first.length === 0 || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return Number.NaN;
  return numerator / denominator;
}

function firstStream(json: unknown): JsonObject | undefined {
  if (!isJsonObject(json)) return undefined;
  const streams = json['streams'];
  if (!Array.isArray(streams)) return undefined;
  const first: unknown = streams[0];
  return isJsonObject(first) ? first : undefined;
}

/** A numeric field that ffprobe may print as a number or as a quoted string; NaN when absent. */
function numberField(stream: JsonObject, name: string): number {
  const value = stream[name];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.length > 0) return Number(value);
  return Number.NaN;
}

function stringField(stream: JsonObject, name: string, fallback: string): string {
  const value = stream[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new DataFileError(path, `ffprobe printed something that is not JSON (${error instanceof Error ? error.message : String(error)})`, 'Run ffprobe on the file by hand to see what it reports.');
  }
}

/** Turns ffprobe's JSON for the video entries into a VideoProbe; throws DataFileError when there is no usable video stream. */
export function parseVideoProbe(json: unknown, path: string): VideoProbe {
  const stream = firstStream(json);
  if (stream === undefined) throw new DataFileError(path, 'ffprobe found no video stream', 'Pass a video file that ffmpeg can decode.');
  const width = numberField(stream, 'width');
  const height = numberField(stream, 'height');
  const fps = parseFrameRate(stringField(stream, 'r_frame_rate', ''));
  const frameCount = numberField(stream, 'nb_read_frames');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new DataFileError(path, `ffprobe reports an unusable size ${String(stream['width'])}x${String(stream['height'])}`, 'The video stream has no dimensions; re-encode the file.');
  if (!Number.isFinite(fps) || fps <= 0) throw new DataFileError(path, `ffprobe reports an unusable frame rate "${stringField(stream, 'r_frame_rate', '')}"`, 'The video stream has no frame rate; re-encode the file with -r.');
  if (!Number.isInteger(frameCount) || frameCount < 0) throw new DataFileError(path, 'ffprobe could not count the frames', 'The file may be truncated; re-encode it.');
  return {
    width,
    height,
    fps,
    frameCount,
    codec: stringField(stream, 'codec_name', 'unknown'),
    pixFmt: stringField(stream, 'pix_fmt', 'unknown'),
    colorSpace: stringField(stream, 'color_space', 'unknown'),
    colorRange: stringField(stream, 'color_range', 'unknown'),
  };
}

/** Turns ffprobe's JSON for the audio entries into an AudioProbe, or undefined when the file has no audio stream. */
export function parseAudioProbe(json: unknown): AudioProbe | undefined {
  const stream = firstStream(json);
  if (stream === undefined) return undefined;
  const sampleRate = numberField(stream, 'sample_rate');
  const channels = numberField(stream, 'channels');
  return {
    codec: stringField(stream, 'codec_name', 'unknown'),
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : 0,
    channels: Number.isFinite(channels) ? channels : 0,
  };
}

/** Runs ffprobe on the first video stream of a file (counting its frames) and returns what it found. */
export async function probeVideo(runner: ProcessRunner, ffprobePath: string, path: string, signal: AbortSignal): Promise<VideoProbe> {
  const result = await runFfmpeg(runner, ffprobePath, videoProbeArgs(path), { label: 'ffprobe', failureHint: `Check that ${path} exists and is a video ffmpeg can decode.` }, signal);
  return parseVideoProbe(parseJson(result.stdout, path), path);
}

/** Runs ffprobe on the first audio stream of a file; undefined when the file has none. */
export async function probeAudio(runner: ProcessRunner, ffprobePath: string, path: string, signal: AbortSignal): Promise<AudioProbe | undefined> {
  const result = await runFfmpeg(runner, ffprobePath, audioProbeArgs(path), { label: 'ffprobe', failureHint: `Check that ${path} exists and is a file ffmpeg can decode.` }, signal);
  return parseAudioProbe(parseJson(result.stdout, path));
}
