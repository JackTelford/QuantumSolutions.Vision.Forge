import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { extractFrame, extractFrameArgs } from '../../src/qa/frame-extract.ts';
import { checkHeroStillMatch, heroFramePath, heroStillArgs } from '../../src/qa/still-match.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, failedResult, matchProgram } from '../fakes/fake-process-runner.ts';
import { ffmpegPath, makeBlackFreezeClip, never, runner } from './synthetic-clips.ts';

const ffmpeg = findFfmpeg();

describe('hero still arguments', () => {
  it('compares planar RGB of the still with the extracted frame, written under the work directory by frame number', () => {
    assert.deepEqual(heroStillArgs('C:\\s\\hero.png', 'C:\\w\\hero-frame-12.png'), ['-i', 'C:\\s\\hero.png', '-i', 'C:\\w\\hero-frame-12.png', '-filter_complex', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim']);
    assert.equal(heroFramePath('C:\\w', 12), join('C:\\w', 'hero-frame-12.png'));
  });

  it('extracts one frame by number without resampling', () => {
    assert.deepEqual(extractFrameArgs('C:\\s\\film.mp4', 10, 'C:\\s\\f10.png'), ['-nostats', '-y', '-i', 'C:\\s\\film.mp4', '-vf', 'select=eq(n\\,10)', '-fps_mode', 'passthrough', '-frames:v', '1', 'C:\\s\\f10.png']);
  });

  it('a video ffmpeg cannot read is an unmeasured failure', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), failedResult(1, 'Invalid data found when processing input'));
    const check = await checkHeroStillMatch(fake, 'C:\\tools\\ffmpeg.exe', 'C:\\s\\hero.png', 'C:\\s\\broken.mp4', 0, tmpdir(), never);
    assert.equal(check.ok, false);
    assert.equal(check.measured, null);
    assert.match(check.detail, /could not measure/);
  });

  it('an error that is not a measurement error propagates', async () => {
    const unexpected = new FakeProcessRunner();
    await assert.rejects(checkHeroStillMatch(unexpected, 'C:\\tools\\ffmpeg.exe', 'C:\\s\\hero.png', 'C:\\s\\film.mp4', 0, tmpdir(), never), /Unexpected process run/);
  });
});

describe('hero still against a synthetic clip', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  let clip = '';
  let still = '';
  before(async () => {
    if (ffmpeg === undefined) return;
    dir = mkdtempSync(join(tmpdir(), 'vf-qa-still-'));
    clip = await makeBlackFreezeClip(dir);
    still = join(dir, 'frame10.png');
    assert.equal(await extractFrame(runner, ffmpegPath(), clip, 10, still, never), true);
    assert.ok(existsSync(still));
  });
  after(() => { if (dir.length > 0) rmSync(dir, { recursive: true, force: true }); });

  it('frame 10 matches its own extracted still with SSIM 1', async () => {
    const check = await checkHeroStillMatch(runner, ffmpegPath(), still, clip, 10, dir, never);
    assert.equal(check.ok, true, check.detail);
    assert.equal(check.measured, 1);
    assert.equal(check.threshold, 0.98);
    assert.deepEqual(check.frames, []);
  });

  it('frame 40 (black) does not match the still and is flagged', async () => {
    const check = await checkHeroStillMatch(runner, ffmpegPath(), still, clip, 40, dir, never);
    assert.equal(check.ok, false);
    assert.ok((check.measured ?? 1) < 0.98, check.detail);
    assert.match(check.detail, /differs from frame10\.png/);
    assert.deepEqual(check.frames, [40]);
  });

  it('a frame past the end is reported as not found and flagged', async () => {
    const check = await checkHeroStillMatch(runner, ffmpegPath(), still, clip, 900, dir, never);
    assert.equal(check.ok, false);
    assert.equal(check.measured, null);
    assert.match(check.detail, /frame 900 was not found/);
    assert.deepEqual(check.frames, [900]);
    assert.equal(await extractFrame(runner, ffmpegPath(), clip, 900, join(dir, 'none.png'), never), false);
  });
});
