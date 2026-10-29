/**
 * WAV files written by hand: the narration's samples arrive from the voice
 * as 32-bit floats and leave as 16-bit PCM mono, the one format every
 * ffmpeg build decodes and the assembler expects. The RIFF header is 44
 * bytes with a `fmt ` chunk of 16 bytes (format 1, PCM); nothing here
 * touches the disk. Pure.
 */

/** The sample rate kokoro-js synthesises at; every narration WAV carries it. */
export const narrationSampleRate = 24_000;

/** Bytes per 16-bit sample. */
const bytesPerSample = 2;

/** The RIFF header's length: 12 bytes of RIFF/WAVE, a 24-byte `fmt ` chunk and an 8-byte `data` chunk header. */
export const wavHeaderBytes = 44;

/** What a WAV header says about its samples. */
export interface WavHeader {
  /** 1 for PCM. */
  readonly format: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  /** Bytes in the data chunk. */
  readonly dataBytes: number;
  /** The total file size the RIFF chunk declares, plus the 8 bytes of its own header. */
  readonly riffBytes: number;
}

/** A float sample in [-1, 1] as a signed 16-bit integer; values outside the range are clamped, never wrapped. */
export function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  // Asymmetric on purpose: -1 maps to -32768 and 1 to 32767, the full 16-bit range.
  return Math.round(clamped < 0 ? clamped * 32_768 : clamped * 32_767);
}

/** The bytes of a 16-bit PCM mono WAV holding the samples at the rate. */
export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError(`A WAV sample rate must be a positive integer, not ${String(sampleRate)}.`);
  const dataBytes = samples.length * bytesPerSample;
  const bytes = new Uint8Array(wavHeaderBytes + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, wavHeaderBytes - 8 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) view.setInt16(wavHeaderBytes + index * bytesPerSample, floatToInt16(samples[index] ?? 0), true);
  return bytes;
}

/** Reads the header of a WAV this file wrote (or any canonical 44-byte PCM header); a RangeError names what is wrong. */
export function parseWavHeader(bytes: Uint8Array): WavHeader {
  if (bytes.length < wavHeaderBytes) throw new RangeError(`A WAV header is ${wavHeaderBytes} bytes; the file has ${bytes.length}.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new RangeError('Not a RIFF WAVE file.');
  if (tag(12) !== 'fmt ') throw new RangeError('The first chunk is not "fmt ".');
  if (tag(36) !== 'data') throw new RangeError('The chunk after "fmt " is not "data".');
  return {
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
    riffBytes: view.getUint32(4, true) + 8,
  };
}

/** The parts joined in order with `gapSamples` zero samples between neighbours (none before the first or after the last). */
export function joinWithSilence(parts: readonly Float32Array[], gapSamples: number): Float32Array {
  if (!Number.isInteger(gapSamples) || gapSamples < 0) throw new RangeError(`The gap must be a non-negative integer sample count, not ${String(gapSamples)}.`);
  const total = parts.reduce((sum, part) => sum + part.length, 0) + Math.max(0, parts.length - 1) * gapSamples;
  const joined = new Float32Array(total);
  let offset = 0;
  parts.forEach((part, index) => {
    if (index > 0) offset += gapSamples;
    joined.set(part, offset);
    offset += part.length;
  });
  return joined;
}

/** A sine of the frequency at the amplitude for the duration, for tests and probes; the phase starts at zero. */
export function sineSamples(frequencyHz: number, seconds: number, sampleRate: number, amplitude = 0.5): Float32Array {
  const count = Math.round(seconds * sampleRate);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) samples[index] = amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
  return samples;
}
