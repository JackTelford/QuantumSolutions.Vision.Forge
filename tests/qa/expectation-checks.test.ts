import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDimensions, checkDuration, checkFps, expectationsFromPlan } from '../../src/qa/expectation-checks.ts';
import { planContext } from '../../src/qa/plan-context.ts';
import type { VideoProbe } from '../../src/qa/probe.ts';
import { planFor } from './synthetic-clips.ts';

const probe: VideoProbe = { width: 320, height: 180, fps: 30, frameCount: 60, codec: 'h264', pixFmt: 'yuv420p', colorSpace: 'bt709', colorRange: 'tv' };

describe('expectation checks', () => {
  it('record the measurement and pass when nothing is expected', () => {
    const dimensions = checkDimensions(probe, {});
    assert.equal(dimensions.ok, true);
    assert.equal(dimensions.threshold, null);
    assert.equal(dimensions.measured, 320);
    assert.match(dimensions.detail, /320x180; no expectation/);
    assert.match(checkFps(probe, {}).detail, /no expectation/);
    const duration = checkDuration(probe, {});
    assert.equal(duration.measured, 60);
    assert.match(duration.detail, /60 frames \(2\.00 s\); no expectation/);
  });

  it('pass when the plan matches', () => {
    const expected = expectationsFromPlan(planContext(planFor([{ id: 'a', frames: 60 }])));
    assert.deepEqual(expected, { width: 320, height: 180, fps: 30, frames: 60 });
    assert.equal(checkDimensions(probe, expected).ok, true);
    assert.equal(checkFps(probe, expected).ok, true);
    assert.equal(checkDuration(probe, expected).ok, true);
    assert.equal(checkDimensions(probe, expected).threshold, 320);
  });

  it('fail and name both values when the plan differs', () => {
    const dimensions = checkDimensions(probe, { width: 1920, height: 1080 });
    assert.equal(dimensions.ok, false);
    assert.match(dimensions.detail, /measured 320x180, expected 1920x1080/);
    const fps = checkFps(probe, { fps: 25 });
    assert.equal(fps.ok, false);
    assert.match(fps.detail, /measured 30 fps, expected 25 fps/);
    const duration = checkDuration(probe, { frames: 61 });
    assert.equal(duration.ok, false);
    assert.equal(duration.threshold, 61);
    assert.match(duration.detail, /expected 61 frames/);
  });

  it('accept a rational frame rate within a thousandth', () => {
    const ntsc = checkFps({ ...probe, fps: 30000 / 1001 }, { fps: 29.97 });
    assert.equal(ntsc.ok, true);
    assert.equal(ntsc.measured, 29.97);
  });
});
