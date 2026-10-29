import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { framePath, framePattern } from '../../src/render/cache.ts';
import { FramehashError, frameRuns, framehashArgs, hashFrames, parseFramehash } from '../../src/render/framehash.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { writeSolidPng } from '../fakes/png.ts';

const never = new AbortController().signal;
const ffmpeg = findFfmpeg();

/** The output ffmpeg 9.0.2 printed for three 16x8 frames. */
const sampleOutput = [
  '#format: frame checksums',
  '#version: 2',
  '#hash: SHA256',
  '#software: Lavf63.1.102',
  '#tb 0: 1/1',
  '#media_type 0: video',
  '#codec_id 0: rawvideo',
  '#dimensions 0: 16x8',
  '#sar 0: 1/1',
  '#stream#, dts,        pts, duration,     size, hash',
  '0,          0,          0,        1,      384, 88a68ce68cdab42a81ebf65baaa84855cfb6c039e6b75012004da307a77b1cee',
  '0,          1,          1,        1,      384, b414c85037b7b6b152d8ea4344c590beabda66efb23e39485fd475cfa415fbd2',
  '0,          2,          2,        1,      384, eb63806b02aa3e597a9837352e45aa436d74167e25cfe551049e3b7d9b5b7f73',
  '',
].join('\n');

describe('framehash arguments and parsing', () => {
  it('splits frames into contiguous runs, sorted and without repeats', () => {
    assert.deepEqual(frameRuns([5, 3, 4, 9, 10, 3]), [{ first: 3, count: 3 }, { first: 9, count: 2 }]);
    assert.deepEqual(frameRuns([]), []);
  });

  it('asks ffmpeg for a run at one frame per second from its start number', () => {
    assert.deepEqual(framehashArgs('C:/c/frames/f%06d.png', { first: 12, count: 30 }), ['-loglevel', 'error', '-framerate', '1', '-start_number', '12', '-i', 'C:/c/frames/f%06d.png', '-frames:v', '30', '-f', 'framehash', '-hash', 'sha256', '-']);
  });

  it('reads the hash of each presentation timestamp and skips the comment lines', () => {
    const hashes = parseFramehash(sampleOutput);
    assert.deepEqual([...hashes.keys()], [0, 1, 2]);
    assert.equal(hashes.get(1), 'b414c85037b7b6b152d8ea4344c590beabda66efb23e39485fd475cfa415fbd2');
    assert.equal(parseFramehash('0, 0, 0, 1, 384, nothex\n').size, 0);
  });

  it('maps the timestamps onto the run and reports a frame ffmpeg printed no hash for', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult(sampleOutput));
    runner.expect(matchProgram('ffmpeg.exe'), okResult(sampleOutput.split('\n').slice(0, 11).join('\n')));
    const hashes = await hashFrames(runner, 'C:\\tools\\ffmpeg.exe', 'C:\\c\\frames', [10, 11, 12], never);
    assert.deepEqual([...hashes.keys()], [10, 11, 12]);
    assert.equal(runner.invocations[0]?.args.includes('-start_number'), true);
    assert.equal(runner.invocations[0]?.args[runner.invocations[0].args.indexOf('-start_number') + 1], '10');
    await assert.rejects(hashFrames(runner, 'C:\\tools\\ffmpeg.exe', 'C:\\c\\frames', [20, 21], never), (error: unknown) => error instanceof FramehashError && error.frames.length === 1 && error.frames[0] === 21 && /frame 21/.test(error.message));
  });
});

describe('framehash with the installed ffmpeg', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  const runner = new ChildProcessRunner();
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-framehash-'));
    writeSolidPng(framePath(dir, 0), 16, 8, [10, 20, 30]);
    writeSolidPng(framePath(dir, 1), 16, 8, [10, 20, 30]);
    writeSolidPng(framePath(dir, 2), 16, 8, [200, 20, 30]);
    writeSolidPng(framePath(dir, 5), 16, 8, [10, 20, 30]);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('hashes decoded pixels: equal colours hash alike, a different colour differs, and a split run is handled', async () => {
    if (ffmpeg === undefined) return;
    const hashes = await hashFrames(runner, ffmpeg.path, dir, [0, 1, 2, 5], never);
    assert.equal(hashes.size, 4);
    for (const hash of hashes.values()) assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hashes.get(0), hashes.get(1));
    assert.equal(hashes.get(0), hashes.get(5));
    assert.notEqual(hashes.get(0), hashes.get(2));
    assert.equal(framePattern(dir).includes('\\'), false);
  });

  it('names the frame that has no PNG', async () => {
    if (ffmpeg === undefined) return;
    await assert.rejects(hashFrames(runner, ffmpeg.path, dir, [1, 2, 3], never), (error: unknown) => error instanceof FramehashError && error.frames[0] === 3);
  });
});
