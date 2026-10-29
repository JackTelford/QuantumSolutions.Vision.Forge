import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DataFileError } from '../../src/errors/vision-forge-error.ts';
import type { Analysis } from '../../src/qa/check.ts';
import { probeVideo } from '../../src/qa/probe.ts';
import { boxLumaFilter, checkTextContrast, parseTextBoxes, pixelBox, readTextBoxes } from '../../src/qa/text-contrast.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { ffmpegPath, ffprobePath, makeBoxesClip, never, runner } from './synthetic-clips.ts';

const ffmpeg = findFfmpeg();
const whiteBox = { frame: 0, box: { x: 0.1, y: 0.2, w: 0.4, h: 0.4 }, textColor: '#000000' };
const grayBox = { frame: 0, box: { x: 0.6, y: 0.2, w: 0.3, h: 0.4 }, textColor: '#808080' };

describe('text boxes file', () => {
  it('parses a well-formed list', () => {
    assert.deepEqual(parseTextBoxes([whiteBox, grayBox], 'boxes.json'), [whiteBox, grayBox]);
  });

  it('names the first bad entry', () => {
    assert.throws(() => parseTextBoxes({ frame: 1 }, 'boxes.json'), (error: unknown) => error instanceof DataFileError && /not a JSON array/.test(error.message));
    assert.throws(() => parseTextBoxes([{ ...whiteBox, frame: -1 }], 'boxes.json'), (error: unknown) => error instanceof DataFileError && /entry 0 has no integer "frame"/.test(error.message));
    assert.throws(() => parseTextBoxes([whiteBox, { ...whiteBox, box: { x: 0, y: 0, w: 0, h: 1 } }], 'boxes.json'), (error: unknown) => error instanceof DataFileError && /entry 1 has no "box"/.test(error.message));
    assert.throws(() => parseTextBoxes([{ ...whiteBox, textColor: 'white' }], 'boxes.json'), (error: unknown) => error instanceof DataFileError && /"textColor" of the form #rrggbb/.test(error.message));
  });

  it('reads the list from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-qa-boxes-'));
    try {
      const path = join(dir, 'boxes.json');
      writeFileSync(path, JSON.stringify([grayBox]), 'utf8');
      assert.deepEqual(readTextBoxes(path), [grayBox]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('turns a normalized box into whole pixels inside the frame, at least 1x1', () => {
    assert.deepEqual(pixelBox(whiteBox.box, 320, 180), { x: 32, y: 36, w: 128, h: 72 });
    assert.deepEqual(pixelBox({ x: 0.99, y: 0.99, w: 0.5, h: 0.5 }, 320, 180), { x: 317, y: 178, w: 3, h: 2 });
    assert.deepEqual(pixelBox({ x: 0, y: 0, w: 0.001, h: 0.001 }, 320, 180), { x: 0, y: 0, w: 1, h: 1 });
    assert.equal(boxLumaFilter({ x: 32, y: 36, w: 128, h: 72 }, 'C:\\w\\box.txt'), "crop=128:72:32:36,scale=out_color_matrix=bt709,format=yuv420p,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file='C\\:/w/box.txt'");
  });
});

describe('text contrast on a clip with drawn boxes', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  let analysis: Analysis;
  before(async () => {
    if (ffmpeg === undefined) return;
    dir = mkdtempSync(join(tmpdir(), 'vf-qa-contrast-'));
    const videoPath = await makeBoxesClip(dir);
    analysis = { runner, ffmpegPath: ffmpegPath(), videoPath, probe: await probeVideo(runner, ffprobePath(), videoPath, never), workDir: dir, signal: never };
  });
  after(() => { if (dir.length > 0) rmSync(dir, { recursive: true, force: true }); });

  it('black text on the white box has a ratio near 21 and passes', async () => {
    const check = await checkTextContrast(analysis, [whiteBox]);
    assert.equal(check.ok, true, check.detail);
    assert.ok((check.measured ?? 0) > 19, check.detail);
    assert.equal(check.threshold, 4.5);
    assert.deepEqual(check.frames, []);
  });

  it('mid-gray text on the mid-gray box fails with the frame flagged', async () => {
    const check = await checkTextContrast(analysis, [whiteBox, grayBox]);
    assert.equal(check.ok, false);
    assert.ok((check.measured ?? 10) < 4.5, check.detail);
    assert.deepEqual(check.frames, [0]);
    assert.match(check.detail, /text box 1 at frame 0 .* has contrast [0-9.]+:1 against text #808080 \(box luma [0-9.]+ averaged with the text pixels, so the true ratio is at least this\)/);
  });

  it('a box on a frame past the end cannot be measured and fails', async () => {
    const check = await checkTextContrast(analysis, [{ ...whiteBox, frame: 999 }]);
    assert.equal(check.ok, false);
    assert.equal(check.measured, null);
    assert.match(check.detail, /frame 999 is beyond the end/);
  });

  it('no boxes is a pass that says so', async () => {
    const check = await checkTextContrast(analysis, []);
    assert.equal(check.ok, true);
    assert.equal(check.measured, null);
    assert.equal(check.detail, 'no text boxes given');
  });
});
