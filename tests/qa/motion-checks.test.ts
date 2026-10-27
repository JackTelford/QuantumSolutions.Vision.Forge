import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Analysis } from '../../src/qa/check.ts';
import { adjacentSsimGraph, checkBlackFrames, checkFrozenFrames, checkPops, freezedetectFilter, judgeBlackFrames, judgeFrozenFrames, judgePops, stillHoldSeconds } from '../../src/qa/motion-checks.ts';
import { planContext } from '../../src/qa/plan-context.ts';
import { probeVideo } from '../../src/qa/probe.ts';
import type { VideoProbe } from '../../src/qa/probe.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { ffmpegPath, ffprobePath, makeBlackFreezeClip, makeCleanClip, never, planFor, runner } from './synthetic-clips.ts';

const ffmpeg = findFfmpeg();
const fakeProbe: VideoProbe = { width: 320, height: 180, fps: 30, frameCount: 60, codec: 'h264', pixFmt: 'yuv420p', colorSpace: 'unknown', colorRange: 'unknown' };

function fakeAnalysis(fake: FakeProcessRunner, workDir: string = tmpdir()): Analysis {
  return { runner: fake, ffmpegPath: 'C:\\tools\\ffmpeg.exe', videoPath: 'C:\\clips\\broken.mp4', probe: fakeProbe, workDir, signal: never };
}

describe('motion judges', () => {
  it('black-frames flags every black frame outside a planned fade to black', () => {
    const plain = judgeBlackFrames([{ start: 1, end: 1.5 }], 30, []);
    assert.equal(plain.ok, false);
    assert.equal(plain.measured, 15);
    assert.deepEqual(plain.frames, [30]);
    assert.match(plain.detail, /15 black frame\(s\) in 1 segment\(s\): frames 30-44/);
    const allowed = judgeBlackFrames([{ start: 1, end: 1.5 }], 30, [{ start: 28, end: 46 }]);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.measured, 0);
    const partly = judgeBlackFrames([{ start: 1, end: 1.5 }], 30, [{ start: 30, end: 40 }]);
    assert.deepEqual(partly.frames, [40]);
    assert.equal(partly.measured, 5);
    assert.match(partly.detail, /5 black frame\(s\) in 1 segment\(s\): frames 40-44$/);
    assert.equal(judgeBlackFrames([], 30, []).detail, 'no black frames');
  });

  it('black-frames names each flagged run when a planned fade sits inside a black segment', () => {
    const split = judgeBlackFrames([{ start: 1, end: 1.5 }], 30, [{ start: 35, end: 40 }]);
    assert.equal(split.measured, 10);
    assert.deepEqual(split.frames, [30]);
    assert.equal(split.detail, '10 black frame(s) in 1 segment(s): frames 30-34, 40-44');
    const twoSegments = judgeBlackFrames([{ start: 1, end: 1.1 }, { start: 2, end: 2.2 }], 30, [{ start: 31, end: 62 }]);
    assert.equal(twoSegments.detail, '5 black frame(s) in 2 segment(s): frame 30, frames 62-65');
    assert.deepEqual(twoSegments.frames, [30, 62]);
  });

  it('frozen-frames runs freezedetect with the tolerated hold as its minimum', () => {
    assert.equal(freezedetectFilter, `freezedetect=n=-60dB:d=${stillHoldSeconds}`);
    assert.equal(freezedetectFilter, 'freezedetect=n=-60dB:d=0.5');
  });

  it('frozen-frames tolerates a freeze that sits inside the last half second of a clip', () => {
    const plain = judgeFrozenFrames([{ start: 1, end: 1.5 }, { start: 1.5, end: 3.5 }], 30, []);
    assert.equal(plain.ok, false);
    assert.deepEqual(plain.frames, [30, 45]);
    assert.equal(plain.measured, 75);
    assert.match(plain.detail, /frames 45-104 are frozen \(2\.00 s\)/);
    const held = judgeFrozenFrames([{ start: 1, end: 1.5 }, { start: 1.5, end: 3.5 }], 30, [{ start: 30, end: 45 }]);
    assert.deepEqual(held.frames, [45]);
    assert.equal(judgeFrozenFrames([{ start: 1, end: 1.5 }], 30, [{ start: 30, end: 45 }]).ok, true);
  });

  it('pops ignores frames within one frame of a planned cut and reports the lowest SSIM elsewhere', () => {
    const ssims = [1, 0.9, 0.3, 0.9, 0.5, 0.95, 0.85, 0.88];
    const unplanned = judgePops(ssims, []);
    assert.equal(unplanned.ok, false);
    assert.deepEqual(unplanned.frames, [2, 4]);
    assert.equal(unplanned.measured, 0.3);
    assert.match(unplanned.detail, /frame 2 differs from frame 1 \(SSIM 0\.3\) with no planned cut there and 1 more/);
    const planned = judgePops(ssims, [2, 5]);
    assert.equal(planned.ok, true);
    assert.equal(planned.measured, 0.88);
    assert.match(planned.detail, /lowest adjacent-frame SSIM 0\.88 at frame 7; no pops \(2 planned cut\(s\) excluded\)/);
    assert.equal(judgePops([], []).measured, null);
  });

  it('a video ffmpeg cannot read is an unmeasured failure, not an exception', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), failedResult(1, 'Invalid data found when processing input'));
    const check = await checkBlackFrames(fakeAnalysis(fake), undefined);
    assert.equal(check.ok, false);
    assert.equal(check.measured, null);
    assert.match(check.detail, /could not measure: ffmpeg blackdetect failed/);
    assert.deepEqual(fake.invocations[0]?.args.slice(0, 4), ['-hide_banner', '-nostats', '-i', 'C:\\clips\\broken.mp4']);
  });

  it('an error that is not a measurement error propagates out of a check', async () => {
    const unexpected = new FakeProcessRunner();
    await assert.rejects(checkBlackFrames(fakeAnalysis(unexpected), undefined), /Unexpected process run/);
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = new FakeProcessRunner();
    cancelled.expect(matchProgram('ffmpeg.exe'), okResult());
    await assert.rejects(checkFrozenFrames({ ...fakeAnalysis(cancelled), signal: aborted.signal }, undefined), /aborted/);
  });

  it('pops cannot be measured when the ssim filter wrote no stats file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-qa-nostats-'));
    try {
      const fake = new FakeProcessRunner();
      fake.expect(matchProgram('ffmpeg.exe'), okResult());
      const check = await checkPops(fakeAnalysis(fake, dir), undefined);
      assert.equal(check.ok, false);
      assert.equal(check.measured, null);
      assert.match(check.detail, /wrote no/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the adjacent-frame graph clones the first frame and quotes the stats path', () => {
    assert.equal(adjacentSsimGraph('C:\\work\\ssim.txt'), "[0:v]split[a][b];[b]tpad=start=1:start_mode=clone[c];[a][c]ssim=stats_file='C\\:/work/ssim.txt'");
  });
});

describe('motion checks on synthetic clips', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  let clean: Analysis;
  let faulty: Analysis;
  before(async () => {
    if (ffmpeg === undefined) return;
    dir = mkdtempSync(join(tmpdir(), 'vf-qa-motion-'));
    clean = await analysisFor(await makeCleanClip(dir), dir);
    faulty = await analysisFor(await makeBlackFreezeClip(dir), dir);
  });
  after(() => { if (dir.length > 0) rmSync(dir, { recursive: true, force: true }); });

  it('a clean testsrc2 clip passes all three checks', async () => {
    for (const check of [await checkBlackFrames(clean, undefined), await checkFrozenFrames(clean, undefined), await checkPops(clean, undefined)]) {
      assert.equal(check.ok, true, `${check.id}: ${check.detail}`);
      assert.deepEqual(check.frames, []);
    }
  });

  it('the black segment is reported as frames 30-44', async () => {
    const check = await checkBlackFrames(faulty, undefined);
    assert.equal(check.ok, false);
    assert.equal(check.measured, 15);
    assert.deepEqual(check.frames, [30]);
    assert.match(check.detail, /frames 30-44/);
  });

  it('the black hole and the gray tail are both frozen without a plan; with a plan only the tail is', async () => {
    const plain = await checkFrozenFrames(faulty, undefined);
    assert.equal(plain.ok, false);
    assert.deepEqual(plain.frames, [30, 45]);
    const planned = await checkFrozenFrames(faulty, planContext(planFor([{ id: 'a', frames: 30 }, { id: 'b', frames: 15 }, { id: 'c', frames: 60 }])));
    assert.equal(planned.ok, false);
    assert.deepEqual(planned.frames, [45]);
    assert.match(planned.detail, /frames 45-104 are frozen/);
  });

  it('the two cuts are pops without a plan and planned cuts with one', async () => {
    const plain = await checkPops(faulty, undefined);
    assert.equal(plain.ok, false);
    assert.deepEqual(plain.frames, [30, 45]);
    assert.ok((plain.measured ?? 1) < 0.6);
    const planned = await checkPops(faulty, planContext(planFor([{ id: 'a', frames: 30 }, { id: 'b', frames: 15 }, { id: 'c', frames: 60 }])));
    assert.equal(planned.ok, true, planned.detail);
    assert.deepEqual(planned.frames, []);
  });
});

async function analysisFor(videoPath: string, workDir: string): Promise<Analysis> {
  return { runner, ffmpegPath: ffmpegPath(), videoPath, probe: await probeVideo(runner, ffprobePath(), videoPath, never), workDir, signal: never };
}
