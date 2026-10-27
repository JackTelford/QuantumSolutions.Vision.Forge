import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DataFileError } from '../../src/errors/vision-forge-error.ts';
import { audioProbeArgs, parseAudioProbe, parseFrameRate, parseVideoProbe, probeAudio, probeVideo, videoProbeArgs } from '../../src/qa/probe.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { ffprobePath, makeCleanClip, makeTone, never, runner } from './synthetic-clips.ts';

const ffmpeg = findFfmpeg();

const videoJson = { streams: [{ codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p', r_frame_rate: '30/1', duration: '3.500000', nb_read_frames: '105' }] };

describe('probe parsing', () => {
  it('parses frame rates given as rationals and rejects junk', () => {
    assert.equal(parseFrameRate('30/1'), 30);
    assert.equal(Math.round(parseFrameRate('30000/1001') * 1000) / 1000, 29.97);
    assert.equal(parseFrameRate('25'), 25);
    assert.ok(Number.isNaN(parseFrameRate('0/0')));
    assert.ok(Number.isNaN(parseFrameRate('')));
    assert.ok(Number.isNaN(parseFrameRate('abc')));
  });

  it('turns the video entries into numbers and fills missing colour tags with "unknown"', () => {
    const probe = parseVideoProbe(videoJson, 'C:\\clips\\b.mp4');
    assert.deepEqual(probe, { width: 320, height: 180, fps: 30, frameCount: 105, codec: 'h264', pixFmt: 'yuv420p', colorSpace: 'unknown', colorRange: 'unknown' });
  });

  it('needs no container duration: the length is the frame count over the rate', () => {
    const probe = parseVideoProbe({ streams: [{ width: 64, height: 64, r_frame_rate: '10/1', nb_read_frames: '25', codec_name: 'png' }] }, 'x.mov');
    assert.equal(probe.frameCount / probe.fps, 2.5);
    assert.ok(!videoProbeArgs('x').some((arg) => arg.includes('duration')));
  });

  it('reports a file without a video stream as a data-file error', () => {
    assert.throws(() => parseVideoProbe({ streams: [] }, 'C:\\clips\\tone.wav'), (error: unknown) => error instanceof DataFileError && error.path === 'C:\\clips\\tone.wav' && /no video stream/.test(error.message));
  });

  it('reports a stream without a frame rate or size', () => {
    assert.throws(() => parseVideoProbe({ streams: [{ width: 0, height: 180, r_frame_rate: '30/1', nb_read_frames: '1' }] }, 'x'), DataFileError);
    assert.throws(() => parseVideoProbe({ streams: [{ width: 320, height: 180, r_frame_rate: '0/0', nb_read_frames: '1' }] }, 'x'), DataFileError);
  });

  it('describes an audio stream and returns undefined when there is none', () => {
    assert.deepEqual(parseAudioProbe({ streams: [{ codec_name: 'pcm_s16le', sample_rate: '48000', channels: 1 }] }), { codec: 'pcm_s16le', sampleRate: 48000, channels: 1 });
    assert.equal(parseAudioProbe({ streams: [] }), undefined);
    assert.equal(parseAudioProbe('garbage'), undefined);
  });
});

describe('probe runs', () => {
  it('asks ffprobe for the video entries as JSON with frame counting on', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffprobe.exe'), okResult(JSON.stringify(videoJson)));
    const probe = await probeVideo(fake, 'C:\\tools\\ffprobe.exe', 'C:\\clips\\b.mp4', never);
    assert.equal(probe.frameCount, 105);
    assert.deepEqual(fake.invocations[0]?.args, ['-hide_banner', ...videoProbeArgs('C:\\clips\\b.mp4')]);
    assert.ok(videoProbeArgs('x').includes('-count_frames'));
    assert.deepEqual(audioProbeArgs('x').slice(0, 4), ['-v', 'error', '-select_streams', 'a:0']);
  });

  it('reports ffprobe output that is not JSON', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffprobe.exe'), okResult('not json'));
    await assert.rejects(probeVideo(fake, 'C:\\tools\\ffprobe.exe', 'C:\\clips\\b.mp4', never), DataFileError);
  });
});

describe('probe on synthetic files', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-qa-probe-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads the geometry, rate and frame count of the clean clip', async () => {
    const probe = await probeVideo(runner, ffprobePath(), await makeCleanClip(dir), never);
    assert.equal(probe.width, 320);
    assert.equal(probe.height, 180);
    assert.equal(probe.fps, 30);
    assert.equal(probe.frameCount, 60);
    assert.equal(probe.codec, 'h264');
    assert.equal(probe.pixFmt, 'yuv420p');
  });

  it('finds no audio in the clean clip and describes a tone', async () => {
    assert.equal(await probeAudio(runner, ffprobePath(), join(dir, 'clean.mp4'), never), undefined);
    const tone = await probeAudio(runner, ffprobePath(), await makeTone(dir, 'tone', 'volume=-20dB'), never);
    assert.equal(tone?.sampleRate, 48000);
    assert.equal(tone?.channels, 1);
  });
});
