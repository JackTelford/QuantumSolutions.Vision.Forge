import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { checkAudio, ebur128AbsoluteGateLufs, judgeLoudness, judgeTruePeak, loudnessArgs, measureLoudness } from '../../src/qa/audio-checks.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner } from '../fakes/fake-process-runner.ts';
import { ffmpegPath, ffprobePath, makeCleanClip, makeTone, never, runner } from './synthetic-clips.ts';

const ffmpeg = findFfmpeg();

describe('loudness judges', () => {
  it('skip with a null measurement when there is no audio', () => {
    const loudness = judgeLoudness(undefined, -16);
    assert.deepEqual([loudness.ok, loudness.measured, loudness.threshold, loudness.unit], [true, null, -16, 'LUFS']);
    assert.match(loudness.detail, /no audio stream; skipped/);
    assert.equal(judgeTruePeak(undefined, -1).ok, true);
  });

  it('accept integrated loudness within one LU of the target and reject the rest', () => {
    assert.equal(judgeLoudness({ integrated: -16.9, truePeak: -5 }, -16).ok, true);
    assert.equal(judgeLoudness({ integrated: -15.1, truePeak: -5 }, -16).ok, true);
    const quiet = judgeLoudness({ integrated: -41.8, truePeak: -38.1 }, -16);
    assert.equal(quiet.ok, false);
    assert.equal(quiet.measured, -41.8);
    assert.match(quiet.detail, /off by 25\.8 LU/);
  });

  it('treat integrated loudness at the -70 LUFS absolute gate (what ebur128 prints for silence) as silence', () => {
    assert.equal(ebur128AbsoluteGateLufs, -70);
    const gated = judgeLoudness({ integrated: -70, truePeak: Number.NEGATIVE_INFINITY }, -16);
    assert.equal(gated.ok, false);
    assert.equal(gated.measured, null);
    assert.match(gated.detail, /silent .*-70 LUFS absolute gate/);
    assert.doesNotMatch(gated.detail, /off by/);
    const minusInf = judgeLoudness({ integrated: Number.NEGATIVE_INFINITY, truePeak: Number.NEGATIVE_INFINITY }, -16);
    assert.deepEqual([minusInf.ok, minusInf.measured], [false, null]);
    assert.equal(judgeLoudness({ integrated: -69.9, truePeak: -60 }, -16).measured, -69.9);
  });

  it('hold the true peak to the ceiling', () => {
    assert.equal(judgeTruePeak({ integrated: -16, truePeak: -1 }, -1).ok, true);
    const hot = judgeTruePeak({ integrated: -16, truePeak: -0.3 }, -1);
    assert.equal(hot.ok, false);
    assert.equal(hot.unit, 'dBTP');
    assert.match(hot.detail, /over by 0\.7 dB/);
    const silent = judgeTruePeak({ integrated: Number.NEGATIVE_INFINITY, truePeak: Number.NEGATIVE_INFINITY }, -1);
    assert.equal(silent.ok, true);
    assert.equal(silent.measured, null);
  });

  it('meter audio only, with true-peak metering on', () => {
    assert.deepEqual(loudnessArgs('C:\\clips\\film.mp4'), ['-i', 'C:\\clips\\film.mp4', '-vn', '-af', 'ebur128=peak=true']);
  });

  it('let an error that is not a measurement error propagate', async () => {
    const unexpected = new FakeProcessRunner();
    await assert.rejects(checkAudio(unexpected, 'C:\\tools\\ffmpeg.exe', 'C:\\tools\\ffprobe.exe', 'C:\\clips\\film.mp4', -16, -1, never), /Unexpected process run/);
  });
});

describe('loudness on synthetic tones', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-qa-audio-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('a tone normalized to -16 LUFS passes loudness and true peak', async () => {
    const tone = await makeTone(dir, 'normalized', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    const [loudness, truePeak] = await checkAudio(runner, ffmpegPath(), ffprobePath(), tone, -16, -1, never);
    assert.equal(loudness.ok, true, loudness.detail);
    assert.ok(Math.abs((loudness.measured ?? 0) + 16) <= 1, loudness.detail);
    assert.equal(truePeak.ok, true, truePeak.detail);
    assert.ok((truePeak.measured ?? 0) <= -1);
  });

  it('a -40 LUFS tone fails loudness', async () => {
    const tone = await makeTone(dir, 'quiet', 'volume=-18.25dB');
    const summary = await measureLoudness(runner, ffmpegPath(), ffprobePath(), tone, never);
    assert.ok(summary !== undefined && Math.abs(summary.integrated + 40) < 0.5, `integrated ${summary?.integrated}`);
    const [loudness] = await checkAudio(runner, ffmpegPath(), ffprobePath(), tone, -16, -1, never);
    assert.equal(loudness.ok, false);
    assert.match(loudness.detail, /target -16 LUFS/);
  });

  it('a silent track fails loudness as silence with a null measurement and passes true peak', async () => {
    const silent = await makeTone(dir, 'silent', 'volume=0');
    const [loudness, truePeak] = await checkAudio(runner, ffmpegPath(), ffprobePath(), silent, -16, -1, never);
    assert.equal(loudness.ok, false);
    assert.equal(loudness.measured, null);
    assert.match(loudness.detail, /the audio is silent/);
    assert.doesNotMatch(loudness.detail, /off by/);
    assert.deepEqual([truePeak.ok, truePeak.measured], [true, null]);
    assert.match(truePeak.detail, /silent/);
  });

  it('a clip without audio skips both checks', async () => {
    const [loudness, truePeak] = await checkAudio(runner, ffmpegPath(), ffprobePath(), await makeCleanClip(dir), -16, -1, never);
    assert.deepEqual([loudness.ok, loudness.measured, truePeak.ok, truePeak.measured], [true, null, true, null]);
  });
});
