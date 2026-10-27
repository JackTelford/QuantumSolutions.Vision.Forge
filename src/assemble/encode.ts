/**
 * The output encoder arguments for each delivery codec. Never `-tune
 * stillimage`: it changes the psychovisual settings per frame content and
 * makes two encodes of the same frames differ. Pure: builds strings.
 */
import { colorTagArguments } from '../finishing/finishing-chain.ts';
import type { Codec, Output } from '../shared/contracts/assembly-plan.ts';

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
 */
export function encodeArguments(output: Output): readonly string[] {
  const faststart = output.faststart ? ['-movflags', '+faststart'] : [];
  switch (output.codec) {
    case 'h264':
      return ['-c:v', 'libx264', '-crf', String(output.crf), '-preset', output.preset, '-pix_fmt', 'yuv420p', ...colorTagArguments(), ...faststart];
    case 'hevc':
      return ['-c:v', 'libx265', '-crf', String(output.crf), '-preset', output.preset, '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', ...colorTagArguments(), ...faststart];
    case 'prores':
      return ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', ...colorTagArguments()];
    default:
      return unreachableCodec(output.codec);
  }
}

function unreachableCodec(codec: never): never {
  throw new Error(`Unknown codec ${String(codec)}.`);
}
