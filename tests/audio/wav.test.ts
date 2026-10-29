import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { floatToInt16, joinWithSilence, narrationSampleRate, parseWavHeader, sineSamples, wavBytes, wavHeaderBytes } from '../../src/audio/wav.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { findFfmpeg, findFfprobe } from '../../src/tools/ffmpeg.ts';

const ffprobe = findFfprobe(findFfmpeg()?.path);
const never = new AbortController().signal;

describe('wavBytes', () => {
  const sine = sineSamples(440, 1, narrationSampleRate);
  const bytes = wavBytes(sine, narrationSampleRate);

  it('writes a one-second 24 kHz sine as 44 header bytes plus two bytes per sample', () => {
    assert.equal(sine.length, 24_000);
    assert.equal(bytes.length, wavHeaderBytes + 48_000);
    assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...bytes.subarray(8, 12)), 'WAVE');
    assert.equal(String.fromCharCode(...bytes.subarray(12, 16)), 'fmt ');
    assert.equal(String.fromCharCode(...bytes.subarray(36, 40)), 'data');
  });

  it('declares PCM, one channel, 24000 Hz, 16 bits and the RIFF and data sizes', () => {
    const header = parseWavHeader(bytes);
    assert.deepEqual(header, { format: 1, channels: 1, sampleRate: 24_000, bitsPerSample: 16, dataBytes: 48_000, riffBytes: bytes.length });
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint32(16, true), 16, 'the fmt chunk is 16 bytes');
    assert.equal(view.getUint32(28, true), 48_000, 'byte rate is rate times block align');
    assert.equal(view.getUint16(32, true), 2, 'block align is two bytes for 16-bit mono');
  });

  it('stores the samples little-endian: the first sample is zero and the quarter-wave peak reaches half scale', () => {
    const view = new DataView(bytes.buffer);
    assert.equal(view.getInt16(wavHeaderBytes, true), 0);
    const quarterWave = Math.round(narrationSampleRate / 440 / 4);
    const peak = view.getInt16(wavHeaderBytes + quarterWave * 2, true);
    assert.ok(peak > 16_000 && peak <= 16_384, `peak ${peak}`);
  });

  it('clamps floats outside [-1, 1] to the 16-bit range instead of wrapping', () => {
    assert.equal(floatToInt16(1), 32_767);
    assert.equal(floatToInt16(-1), -32_768);
    assert.equal(floatToInt16(3), 32_767);
    assert.equal(floatToInt16(-3), -32_768);
    assert.equal(floatToInt16(0.5), 16_384);
  });

  it('refuses a sample rate that is not a positive integer', () => {
    assert.throws(() => wavBytes(sine, 0), RangeError);
    assert.throws(() => wavBytes(sine, 24_000.5), RangeError);
  });
});

describe('parseWavHeader', () => {
  it('names what is wrong with a short or foreign file', () => {
    assert.throws(() => parseWavHeader(new Uint8Array(10)), /44 bytes/);
    const notRiff = wavBytes(new Float32Array(4), 8_000);
    notRiff[0] = 0x58;
    assert.throws(() => parseWavHeader(notRiff), /Not a RIFF WAVE/);
  });
});

describe('joinWithSilence', () => {
  it('puts the gap between neighbours only', () => {
    const joined = joinWithSilence([Float32Array.of(1, 1), Float32Array.of(2), Float32Array.of(3, 3, 3)], 2);
    assert.deepEqual([...joined], [1, 1, 0, 0, 2, 0, 0, 3, 3, 3]);
    assert.equal(joinWithSilence([], 5).length, 0);
    assert.deepEqual([...joinWithSilence([Float32Array.of(7)], 5)], [7]);
  });

  it('refuses a negative or fractional gap', () => {
    assert.throws(() => joinWithSilence([], -1), RangeError);
    assert.throws(() => joinWithSilence([], 1.5), RangeError);
  });
});

describe('a written WAV read back through ffprobe', { skip: ffprobe === undefined ? 'ffprobe is not installed' : false }, () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-wav-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is pcm_s16le, mono, 24000 Hz and one second long', async () => {
    const path = join(dir, 'sine.wav');
    writeFileSync(path, wavBytes(sineSamples(440, 1, narrationSampleRate), narrationSampleRate));
    const runner = new ChildProcessRunner();
    const result = await runner.run({ label: 'ffprobe', executable: ffprobe?.path ?? '', args: ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,duration', '-of', 'json', path], timeoutMs: 30_000 }, never);
    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as { streams: { codec_name: string; sample_rate: string; channels: number; duration: string }[] };
    const stream = parsed.streams[0];
    assert.equal(stream?.codec_name, 'pcm_s16le');
    assert.equal(stream?.sample_rate, '24000');
    assert.equal(stream?.channels, 1);
    assert.ok(Math.abs(Number(stream?.duration) - 1) < 0.001, `duration ${stream?.duration}`);
  });
});
