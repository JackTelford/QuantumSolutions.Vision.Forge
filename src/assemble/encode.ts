/**
 * The output encoder arguments for each delivery codec. Never `-tune
 * stillimage`: it changes the psychovisual settings per frame content and
 * makes two encodes of the same frames differ. Pure: builds strings.
 */
import { colorTagArguments } from '../finishing/finishing-chain.ts';
import type { Codec, Output } from '../shared/contracts/assembly-plan.ts';

/** The frame the delivery is encoded at, which sets its bitrate ceiling. */
export interface EncodeFrame {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

/** The bitrate ceiling at 1080p30 in kilobits per second; scaled by pixels and frame rate. A ceiling, not a target: CRF sets the quality and the cap only bites when grain or noise would otherwise balloon the file (a 70 s noir piece encoded at 38 Mb/s, 331 MB, before it). */
export const bitrateCeilingKbpsAt1080p30 = 10_000;

/** The `-maxrate` for a frame in kb/s: the 1080p30 ceiling scaled by the pixel count and the frame rate, at least 500. */
export function bitrateCeilingKbps(frame: EncodeFrame): number {
  return Math.max(500, Math.round((bitrateCeilingKbpsAt1080p30 * frame.width * frame.height * frame.fps) / (1920 * 1080 * 30)));
}

function rateCapArguments(frame: EncodeFrame | undefined): readonly string[] {
  if (frame === undefined) return [];
  const kbps = bitrateCeilingKbps(frame);
  return ['-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`];
}

/** The audio codec arguments that go with a video codec: AAC 192 kb/s in MP4, PCM in a ProRes MOV. */
export function audioCodecArguments(codec: Codec): readonly string[] {
  return codec === 'prores' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k'];
}

/**
 * Video encoder arguments: libx264 or libx265 with the plan's CRF and
 * preset in yuv420p (hevc tagged hvc1 so Apple players open it), or
 * prores_ks profile 3 (422 HQ) in yuv422p10le. All carry BT.709 colour
 * tags; MP4 outputs get `-movflags +faststart` when the plan asks for it.
 *
 * The ProRes delivery is 10-bit 4:2:2 in the container only: every clip is
 * normalized to 8-bit yuv420p (normalize.ts) and a vignette or grain drops
 * the finishing chain to 8-bit RGB, so the extra depth carries no extra
 * picture information. It is an edit-friendly format, not a mezzanine.
 *
 * With a frame, the H.264 and HEVC encodes carry a bitrate ceiling
 * (`-maxrate` and a two-second `-bufsize`) from bitrateCeilingKbps; ProRes
 * never does.
 */
export function encodeArguments(output: Output, frame?: EncodeFrame): readonly string[] {
  const faststart = output.faststart ? ['-movflags', '+faststart'] : [];
  const cap = rateCapArguments(frame);
  switch (output.codec) {
    case 'h264':
      return ['-c:v', 'libx264', '-crf', String(output.crf), '-preset', output.preset, ...cap, '-pix_fmt', 'yuv420p', ...colorTagArguments(), ...faststart];
    case 'hevc':
      return ['-c:v', 'libx265', '-crf', String(output.crf), '-preset', output.preset, ...cap, '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', ...colorTagArguments(), ...faststart];
    case 'prores':
      return ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', ...colorTagArguments()];
    default:
      return unreachableCodec(output.codec);
  }
}

function unreachableCodec(codec: never): never {
  throw new Error(`Unknown codec ${String(codec)}.`);
}
