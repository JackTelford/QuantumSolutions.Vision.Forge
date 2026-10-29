import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { calibrationPatches, meanRgbArgs, measurePatches, measureSwatchHues, parseRgb24Pixel, saturatedSwatches } from '../../src/calibration/measure.ts';
import type { MeasureOptions } from '../../src/calibration/measure.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { expectedYavg } from '../../src/shared/calibration/scene.ts';
import { findFfmpeg, runFfmpeg } from '../../src/tools/ffmpeg.ts';
import { writeSolidPng } from '../fakes/png.ts';

const ffmpeg = findFfmpeg()?.path;
const skip = ffmpeg === undefined ? 'ffmpeg is not installed' : false;
const never = new AbortController().signal;
const width = 192;
const height = 108;

describe('meanRgbArgs and parseRgb24Pixel', () => {
  it('crops the box, averages it to one pixel with the area scaler and writes three raw bytes', () => {
    assert.deepEqual(meanRgbArgs('in.png', { x: 10, y: 20, w: 30, h: 40 }, 'out.rgb'), ['-nostats', '-y', '-i', 'in.png', '-vf', 'crop=30:40:10:20,scale=1:1:flags=area,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', 'out.rgb']);
  });

  it('reads the three bytes as a colour and refuses any other length', () => {
    assert.deepEqual(parseRgb24Pixel(new Uint8Array([204, 0, 10])), { r: 204, g: 0, b: 10 });
    assert.throws(() => parseRgb24Pixel(new Uint8Array([1, 2])), RangeError);
  });
});

describe('the calibration scene as the measurement sees it', () => {
  it('has nine patches, six of them saturated swatches, in scene order', () => {
    assert.deepEqual(calibrationPatches().map((patch) => patch.id), ['white-90', 'gray-18', 'black-2', 'swatch-red', 'swatch-yellow', 'swatch-green', 'swatch-cyan', 'swatch-blue', 'swatch-magenta']);
    assert.deepEqual(saturatedSwatches().map((patch) => patch.id), ['swatch-red', 'swatch-yellow', 'swatch-green', 'swatch-cyan', 'swatch-blue', 'swatch-magenta']);
  });
});

describe('measurePatches and measureSwatchHues on solid PNGs through real ffmpeg', { skip }, () => {
  let dir = '';
  const runner = new ChildProcessRunner();

  function options(png: string): MeasureOptions {
    assert.ok(ffmpeg !== undefined);
    return { runner, ffmpegPath: ffmpeg, png, width, height, workDir: join(dir, 'work'), signal: never };
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-measure-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the gray card\'s expected 117.3 from a solid #767676 frame and fails the patches of other colours', { timeout: 60_000 }, async () => {
    const png = join(dir, 'gray.png');
    writeSolidPng(png, width, height, [118, 118, 118]);
    const measured = await measurePatches(options(png));
    const gray = measured.find((row) => row.id === 'gray-18');
    assert.ok(gray !== undefined && gray.measuredYavg !== null && gray.delta !== null);
    assert.ok(Math.abs(gray.measuredYavg - 117.3) < 1, `gray card measured ${String(gray.measuredYavg)}`);
    assert.ok(gray.ok);
    assert.ok(Math.abs(gray.delta) < 1);
    assert.deepEqual(gray.meanRgb, { r: 118, g: 118, b: 118 });
    const white = measured.find((row) => row.id === 'white-90');
    assert.ok(white !== undefined && white.delta !== null);
    assert.ok(!white.ok);
    assert.ok(white.delta < -100, 'a gray frame reads far under the white patch\'s expectation');
    assert.equal(measured.length, 9);
  });

  it('reads a solid white frame at the white patch\'s expectation within one code value', { timeout: 60_000 }, async () => {
    const png = join(dir, 'white.png');
    writeSolidPng(png, width, height, [243, 243, 243]);
    const white = (await measurePatches(options(png))).find((row) => row.id === 'white-90');
    assert.ok(white !== undefined && white.measuredYavg !== null);
    assert.ok(Math.abs(white.measuredYavg - expectedYavg('#f3f3f3')) < 1, `white measured ${String(white.measuredYavg)}`);
    assert.ok(white.ok);
    assert.deepEqual(white.meanRgb, { r: 243, g: 243, b: 243 });
  });

  it('averages the whole box, not a few taps: a gray card half white and half black reads a mean of 127 to 128 on every channel', { timeout: 60_000 }, async () => {
    // The gray card spans pixels 77 to 114 at 192 px wide, so a frame split at pixel 96 puts 19 white and 19 black columns inside it; a bicubic 1x1 scale samples the middle and misses the mean by several code values.
    assert.ok(ffmpeg !== undefined);
    const left = join(dir, 'left.png');
    const right = join(dir, 'right.png');
    const png = join(dir, 'two-tone.png');
    writeSolidPng(left, width / 2, height, [255, 255, 255]);
    writeSolidPng(right, width / 2, height, [0, 0, 0]);
    await runFfmpeg(runner, ffmpeg, ['-nostats', '-y', '-i', left, '-i', right, '-filter_complex', 'hstack', '-frames:v', '1', '-update', '1', png], { label: 'ffmpeg hstack' }, never);
    const gray = (await measurePatches(options(png))).find((row) => row.id === 'gray-18');
    assert.ok(gray !== undefined);
    for (const channel of [gray.meanRgb.r, gray.meanRgb.g, gray.meanRgb.b]) assert.ok(channel >= 127 && channel <= 128, `channel ${String(channel)} is not the mean of 19 white and 19 black columns`);
  });

  it('reads a solid red frame as hue 0 everywhere: the red swatch turns 0 degrees, the green one 120 the short way', { timeout: 60_000 }, async () => {
    const png = join(dir, 'red.png');
    writeSolidPng(png, width, height, [204, 0, 0]);
    const hues = await measureSwatchHues(options(png));
    assert.equal(hues.length, 6);
    const red = hues.find((row) => row.id === 'swatch-red');
    const green = hues.find((row) => row.id === 'swatch-green');
    const magenta = hues.find((row) => row.id === 'swatch-magenta');
    assert.ok(red !== undefined && green !== undefined && magenta !== undefined);
    assert.deepEqual(red.rgb, { r: 204, g: 0, b: 0 });
    assert.equal(red.measuredHueDeg, 0);
    assert.equal(red.deltaDeg, 0);
    assert.equal(red.saturation, 1);
    assert.equal(green.expectedHueDeg, 120);
    assert.equal(green.deltaDeg, -120);
    assert.equal(magenta.deltaDeg, 60);
  });
});
