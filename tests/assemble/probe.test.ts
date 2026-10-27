import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeliveryProbeTimeoutError } from '../../src/assemble/assemble-error.ts';
import { parseProbeOutput, probeArguments, probeTimeoutMs, probeVideo } from '../../src/assemble/probe.ts';
import { ProcessFailedError } from '../../src/errors/vision-forge-error.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;
const ffprobeExe = 'C:\\tools\\ffmpeg\\ffprobe.exe';
const delivery = 'C:\\vf\\out\\film.mp4';
const complete = 'width=1920\nheight=1080\nsample_aspect_ratio=1:1\npix_fmt=yuv420p\ncolor_space=bt709\nr_frame_rate=30/1\nnb_read_frames=150\n';
const completeParsed = { frames: 150, fps: 30, width: 1920, height: 1080, pixelFormat: 'yuv420p', colorSpace: 'bt709', sampleAspectRatio: '1:1' };

describe('probeArguments', () => {
  it('counts the frames of the first video stream and prints seven entries as key=value lines', () => {
    assert.deepEqual(probeArguments(delivery), [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames,r_frame_rate,width,height,sample_aspect_ratio,pix_fmt,color_space',
      '-of', 'default=noprint_wrappers=1', delivery,
    ]);
  });
});

describe('parseProbeOutput', () => {
  it('reads every entry of a complete block', () => {
    assert.deepEqual(parseProbeOutput(complete), completeParsed);
  });

  it('accepts CRLF line endings and whitespace around the values', () => {
    const crlf = complete.replace(/\n/g, '\r\n').replace('width=1920', 'width= 1920 ');
    assert.deepEqual(parseProbeOutput(crlf), completeParsed);
  });

  it('turns a missing frame count into NaN and missing strings into "unknown"', () => {
    const probed = parseProbeOutput('width=320\nheight=180\nr_frame_rate=30/1\n');
    assert.ok(Number.isNaN(probed.frames));
    assert.equal(probed.width, 320);
    assert.equal(probed.height, 180);
    assert.equal(probed.fps, 30);
    assert.equal(probed.pixelFormat, 'unknown');
    assert.equal(probed.colorSpace, 'unknown');
    assert.equal(probed.sampleAspectRatio, 'unknown');
  });

  it('divides a fractional rate such as 30000/1001', () => {
    const probed = parseProbeOutput(complete.replace('r_frame_rate=30/1', 'r_frame_rate=30000/1001'));
    assert.ok(Math.abs(probed.fps - 30000 / 1001) < 1e-12, `fps ${probed.fps}`);
  });

  it('gives NaN for a rate of 0/0, a rate without a slash, or no rate line', () => {
    assert.ok(Number.isNaN(parseProbeOutput(complete.replace('r_frame_rate=30/1', 'r_frame_rate=0/0')).fps));
    assert.ok(Number.isNaN(parseProbeOutput(complete.replace('r_frame_rate=30/1', 'r_frame_rate=30')).fps));
    assert.ok(Number.isNaN(parseProbeOutput(complete.replace('r_frame_rate=30/1\n', '')).fps));
    assert.ok(Number.isNaN(parseProbeOutput('').fps));
  });

  it('keeps a value that itself contains an equals sign, passes "N/A" through and ignores lines without a key', () => {
    const probed = parseProbeOutput(`${complete}TAG:comment=a=b\nno key here\n=orphan\nsample_aspect_ratio=N/A\n`);
    assert.deepEqual(probed, { ...completeParsed, sampleAspectRatio: 'N/A' });
  });
});

describe('probeTimeoutMs', () => {
  it('is two minutes up to 1200 frames and 100 ms per frame beyond, ignoring nonsense counts', () => {
    assert.equal(probeTimeoutMs(50), 120_000);
    assert.equal(probeTimeoutMs(1200), 120_000);
    assert.equal(probeTimeoutMs(1201), 120_100);
    assert.equal(probeTimeoutMs(18_000), 1_800_000);
    assert.equal(probeTimeoutMs(Number.NaN), 120_000);
    assert.equal(probeTimeoutMs(-5), 120_000);
  });
});

describe('probeVideo', () => {
  it('runs ffprobe with the frame-count budget and parses what it printed', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffprobe.exe'), okResult(complete));
    const probed = await probeVideo(fake, ffprobeExe, delivery, 18_000, never);
    assert.deepEqual(probed, completeParsed);
    assert.equal(fake.invocations[0]?.executable, ffprobeExe);
    assert.deepEqual(fake.invocations[0]?.args, ['-hide_banner', ...probeArguments(delivery)]);
    assert.equal(fake.invocations[0]?.timeoutMs, 1_800_000);
    fake.assertAllUsed();
  });

  it('turns a timeout into DeliveryProbeTimeoutError whose hint says the delivery was written', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffprobe.exe'), { exitCode: null, signal: 'SIGKILL', stdout: '', stderr: '', elapsedMs: 120_000, timedOut: true });
    await assert.rejects(
      probeVideo(fake, ffprobeExe, delivery, 50, never),
      (error: unknown) => error instanceof DeliveryProbeTimeoutError
        && error.code === 'assemble-probe-timeout'
        && error.outputPath === delivery
        && error.timeoutMs === 120_000
        && /within 120 s/.test(error.message)
        && /was written/.test(error.hint)
        && /ffprobe -count_frames/.test(error.hint),
    );
  });

  it('lets a failed ffprobe surface as ProcessFailedError with the read-back hint', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffprobe.exe'), failedResult(1, 'moov atom not found'));
    await assert.rejects(probeVideo(fake, ffprobeExe, delivery, 50, never), (error: unknown) => error instanceof ProcessFailedError && /truncated/.test(error.hint) && /moov atom/.test(error.message));
  });
});
