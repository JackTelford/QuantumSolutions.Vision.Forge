import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audioCodecArguments, encodeArguments } from '../../src/assemble/encode.ts';
import type { Output } from '../../src/shared/contracts/assembly-plan.ts';

const tags = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];

describe('encodeArguments', () => {
  it('encodes h264 with libx264 at the plan crf and preset in yuv420p, tagged BT.709, with faststart when asked', () => {
    const output: Output = { path: 'C:\\vf\\out\\film.mp4', codec: 'h264', crf: 16, preset: 'medium', faststart: true };
    assert.deepEqual(encodeArguments(output), ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...tags, '-movflags', '+faststart']);
    assert.deepEqual(encodeArguments({ ...output, faststart: false }), ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...tags]);
  });

  it('encodes hevc with libx265 tagged hvc1', () => {
    const output: Output = { path: 'C:\\vf\\out\\film.mp4', codec: 'hevc', crf: 20, preset: 'slow', faststart: true };
    assert.deepEqual(encodeArguments(output), ['-c:v', 'libx265', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', ...tags, '-movflags', '+faststart']);
  });

  it('encodes prores as prores_ks 422 HQ in yuv422p10le and ignores crf, preset and faststart', () => {
    const output: Output = { path: 'C:\\vf\\out\\film.mov', codec: 'prores', crf: 16, preset: 'medium', faststart: true };
    assert.deepEqual(encodeArguments(output), ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', ...tags]);
  });

  it('never tunes for still images', () => {
    for (const codec of ['h264', 'hevc', 'prores'] as const) {
      assert.ok(!encodeArguments({ path: 'x', codec, crf: 16, preset: 'medium', faststart: true }).includes('stillimage'));
    }
  });
});

describe('audioCodecArguments', () => {
  it('uses AAC 192k in MP4 and PCM in a ProRes MOV', () => {
    assert.deepEqual(audioCodecArguments('h264'), ['-c:a', 'aac', '-b:a', '192k']);
    assert.deepEqual(audioCodecArguments('hevc'), ['-c:a', 'aac', '-b:a', '192k']);
    assert.deepEqual(audioCodecArguments('prores'), ['-c:a', 'pcm_s16le']);
  });
});
