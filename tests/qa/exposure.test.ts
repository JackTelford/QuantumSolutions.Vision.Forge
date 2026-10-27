import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Analysis } from '../../src/qa/check.ts';
import { checkExposureDrift, judgeExposureDrift, secondWindows, windowMeans } from '../../src/qa/exposure.ts';
import { planContext } from '../../src/qa/plan-context.ts';
import { probeVideo } from '../../src/qa/probe.ts';
import type { VideoProbe } from '../../src/qa/probe.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { ffmpegPath, ffprobePath, makeTwoPatternClip, never, planFor, runner } from './synthetic-clips.ts';

const ffmpeg = findFfmpeg();
const fakeProbe: VideoProbe = { width: 320, height: 180, fps: 30, frameCount: 60, codec: 'h264', pixFmt: 'yuv420p', colorSpace: 'unknown', colorRange: 'unknown' };

describe('exposure judge', () => {
  it('cuts a frame count into one-second windows, the last one keeping the remainder', () => {
    assert.deepEqual(secondWindows(75, 30), [{ label: 'second 1', start: 0, end: 30 }, { label: 'second 2', start: 30, end: 60 }, { label: 'second 3', start: 60, end: 75 }]);
    assert.deepEqual(secondWindows(0, 30), []);
  });

  it('averages the measured frames of each window and marks an empty window NaN', () => {
    const means = windowMeans([100, 110, 120, 20], [{ label: 'a', start: 0, end: 3 }, { label: 'b', start: 3, end: 4 }, { label: 'c', start: 4, end: 6 }]);
    assert.deepEqual(means.map((m) => m.mean), [110, 20, Number.NaN]);
  });

  it('flags a jump over 40 YAVG between consecutive ranges unless a transition sits between them', () => {
    const ranges = [{ label: 'clip "a"', start: 0, end: 30, mean: 121 }, { label: 'clip "b"', start: 30, end: 60, mean: 52 }, { label: 'clip "c"', start: 60, end: 90, mean: 60 }];
    const drift = judgeExposureDrift(ranges, () => true);
    assert.equal(drift.ok, false);
    assert.equal(drift.measured, 69);
    assert.deepEqual(drift.frames, [30]);
    assert.match(drift.detail, /clip "b" \(YAVG 52\) follows clip "a" \(YAVG 121\): difference 69 with no transition between them/);
    const bridged = judgeExposureDrift(ranges, (index) => index !== 0);
    assert.equal(bridged.ok, true);
    assert.equal(bridged.measured, 8);
    assert.equal(judgeExposureDrift(ranges.slice(0, 1), () => true).measured, null);
  });

  it('cannot measure when signalstats wrote no values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-qa-novalues-'));
    try {
      const fake = new FakeProcessRunner();
      fake.expect(matchProgram('ffmpeg.exe'), okResult());
      const check = await checkExposureDrift({ runner: fake, ffmpegPath: 'C:\\tools\\ffmpeg.exe', videoPath: 'C:\\clips\\film.mp4', probe: fakeProbe, workDir: dir, signal: never }, undefined);
      assert.equal(check.ok, false);
      assert.equal(check.measured, null);
      assert.match(check.detail, /wrote no/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('exposure drift on a two-pattern clip', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  let analysis: Analysis;
  before(async () => {
    if (ffmpeg === undefined) return;
    dir = mkdtempSync(join(tmpdir(), 'vf-qa-exposure-'));
    const videoPath = await makeTwoPatternClip(dir);
    analysis = { runner, ffmpegPath: ffmpegPath(), videoPath, probe: await probeVideo(runner, ffprobePath(), videoPath, never), workDir: dir, signal: never };
  });
  after(() => { if (dir.length > 0) rmSync(dir, { recursive: true, force: true }); });

  it('fails across a hard cut between the patterns and names both clips', async () => {
    const check = await checkExposureDrift(analysis, planContext(planFor([{ id: 'bright', frames: 30 }, { id: 'dim', frames: 30 }])));
    assert.equal(check.ok, false);
    assert.ok((check.measured ?? 0) > 40, check.detail);
    assert.deepEqual(check.frames, [30]);
    assert.match(check.detail, /clip "dim" \(YAVG [0-9.]+\) follows clip "bright"/);
  });

  it('passes when the plan puts a dissolve between them', async () => {
    const check = await checkExposureDrift(analysis, planContext(planFor([{ id: 'bright', frames: 30 }, { id: 'dim', frames: 30 }], [{ afterClipId: 'bright', type: 'dissolve', frames: 10 }])));
    assert.equal(check.ok, true, check.detail);
    assert.deepEqual(check.frames, []);
  });

  it('compares one-second windows when there is no plan', async () => {
    const check = await checkExposureDrift(analysis, undefined);
    assert.equal(check.ok, false);
    assert.match(check.detail, /second 2 .* follows second 1/);
  });
});
