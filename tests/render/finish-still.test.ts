import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { cubePathBeside, finishStill, finishStillArgs, stillCompositeGraph, stillFinishingFilters, textOverlayFilter } from '../../src/render/finish-still.ts';
import { findFfmpeg, runFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { writeSolidPng } from '../fakes/png.ts';
import { lookBibleExample, mutated } from '../schema/documents/examples.ts';

const never = new AbortController().signal;
const ffmpeg = findFfmpeg();

/** One pixel of a PNG as "r,g,b", decoded by ffmpeg the way the QA checks decode frames. */
function pixelAt(ffmpegPath: string, pngPath: string, x: number, y: number): string {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', pngPath, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { shell: false, timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr.toString('utf8'));
  return Array.from(result.stdout.subarray(0, 3)).join(',');
}

describe('still finishing chain', () => {
  it('grades in 16-bit RGB through the LUT, drops to rgb24 for the vignette and ends in rgb24, without grain', () => {
    assert.deepEqual(stillFinishingFilters(lookBibleExample.grade, 'C:\\j\\stills\\s03-r1.cube'), [
      'format=gbrp16le',
      "lut3d=file='C\\:/j/stills/s03-r1.cube':interp=tetrahedral",
      'format=rgb24',
      'vignette=angle=PI/10',
      'format=rgb24',
    ]);
    const flat = mutated(lookBibleExample, (copy) => { copy.grade.vignetteAmount = 0; });
    assert.deepEqual(stillFinishingFilters(flat.grade, '/j/s.cube'), ['format=gbrp16le', "lut3d=file='/j/s.cube':interp=tetrahedral", 'format=rgb24']);
    assert.equal(stillFinishingFilters(lookBibleExample.grade, 'x.cube').some((step) => step.startsWith('noise')), false);
  });

  it('names the cube beside the still and writes one PNG with -update 1', () => {
    assert.equal(cubePathBeside('C:\\j\\stills\\s03-r1.png'), 'C:\\j\\stills\\s03-r1.cube');
    assert.deepEqual(finishStillArgs('raw.png', 'out.png', ['a', 'b']), ['-nostats', '-y', '-i', 'raw.png', '-vf', 'a,b', '-frames:v', '1', '-update', '1', 'out.png']);
  });

  it('lays a text plate over the graded picture after the grade, never before it, when a plate is given', () => {
    assert.equal(stillCompositeGraph(['a', 'b']), `[0:v]a,b[picture];[picture][1:v]${textOverlayFilter}[still]`);
    assert.equal(textOverlayFilter, 'overlay=format=auto,format=rgb24');
    assert.deepEqual(finishStillArgs('raw.png', 'out.png', ['a'], 'text.png'), ['-nostats', '-y', '-i', 'raw.png', '-i', 'text.png', '-filter_complex', '[0:v]a[picture];[picture][1:v]overlay=format=auto,format=rgb24[still]', '-map', '[still]', '-frames:v', '1', '-update', '1', 'out.png']);
  });

  it('writes the cube, then runs ffmpeg once over the raw frame', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-finish-fake-'));
    try {
      const runner = new FakeProcessRunner();
      runner.expect(matchProgram('ffmpeg.exe'), okResult());
      const finished = join(dir, 'stills', 's03-r1.png');
      await finishStill(runner, 'C:\\tools\\ffmpeg.exe', join(dir, 'raw.png'), finished, lookBibleExample, never);
      const cube = readFileSync(cubePathBeside(finished), 'utf8');
      assert.match(cube, /^TITLE "Vision\.Forge grade"\nLUT_3D_SIZE 33\n/);
      assert.equal(runner.invocations.length, 1);
      assert.equal(runner.invocations[0]?.args.at(-1), finished);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('still finishing with the installed ffmpeg', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  const runner = new ChildProcessRunner();
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-finish-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('produces a PNG of the same size whose pixels the grade changed', async () => {
    if (ffmpeg === undefined) return;
    const raw = join(dir, 'raw.png');
    writeSolidPng(raw, 64, 36, [118, 118, 118]);
    const finished = join(dir, 'stills', 's03-r1.png');
    await finishStill(runner, ffmpeg.path, raw, finished, lookBibleExample, never);
    assert.ok(existsSync(finished));
    const probe = await runFfmpeg(runner, ffmpeg.path, ['-i', finished, '-f', 'null', '-'], { label: 'ffmpeg probe' }, never);
    assert.match(probe.stderr, /64x36/);
    const compare = await runFfmpeg(runner, ffmpeg.path, ['-i', raw, '-i', finished, '-filter_complex', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]psnr', '-f', 'null', '-'], { label: 'ffmpeg psnr' }, never);
    const psnr = /average:([0-9.]+|inf)/.exec(compare.stderr)?.[1] ?? 'inf';
    assert.notEqual(psnr, 'inf', compare.stderr);
    assert.ok(Number(psnr) < 45, `PSNR ${psnr} means the grade barely changed the picture`);
  });

  it('shows the text plate\'s opaque pixels ungraded on top of the graded picture and the picture through its transparent ones', async () => {
    if (ffmpeg === undefined) return;
    const raw = join(dir, 'raw-plated.png');
    writeSolidPng(raw, 64, 36, [118, 118, 118]);
    // A plate with alpha: an opaque white box from (8, 8) to (31, 23) over transparency, as the html lane's text would be captured.
    const text = join(dir, 'plate.png');
    await runFfmpeg(runner, ffmpeg.path, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', "color=c=white:size=64x36:rate=1:duration=1,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,8,31)*between(Y,8,23),255,0)'", '-frames:v', '1', '-pix_fmt', 'rgba', '-update', '1', text], { label: 'ffmpeg plate' }, never);
    const finished = join(dir, 'stills', 's01-r1.png');
    await finishStill(runner, ffmpeg.path, raw, finished, lookBibleExample, never, text);
    const bare = join(dir, 'stills', 's01-r1-bare.png');
    await finishStill(runner, ffmpeg.path, raw, bare, lookBibleExample, never);
    assert.equal(pixelAt(ffmpeg.path, finished, 16, 16), '255,255,255', 'inside the plate the text is on top, untouched by the grade');
    assert.equal(pixelAt(ffmpeg.path, finished, 48, 30), pixelAt(ffmpeg.path, bare, 48, 30), 'outside the plate the graded picture shows through');
    assert.notEqual(pixelAt(ffmpeg.path, finished, 48, 30), '118,118,118', 'the picture under the plate was graded');
  });
});
