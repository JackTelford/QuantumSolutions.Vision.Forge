import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { cubePathBeside, finishStill, finishStillArgs, stillFinishingFilters } from '../../src/render/finish-still.ts';
import { findFfmpeg, runFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { writeSolidPng } from '../fakes/png.ts';
import { lookBibleExample, mutated } from '../schema/documents/examples.ts';

const never = new AbortController().signal;
const ffmpeg = findFfmpeg();

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
});
