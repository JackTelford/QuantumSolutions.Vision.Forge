import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bt709Scale, colorTagArguments, finishingFilters, grainFilter, vignetteFilter } from '../../src/finishing/finishing-chain.ts';
import type { FinishingGrade } from '../../src/shared/contracts/assembly-plan.ts';

const grade: FinishingGrade = { cubePath: 'C:\\vf\\look\\film.cube', vignetteAmount: 0.5, vignetteSoftness: 0.6, grainAmount: 0.15, grainSeed: 7 };
const quotedCube = "'C\\:/vf/look/film.cube'";

describe('finishingFilters', () => {
  it('without a grade is the 16-bit RGB pass, the BT.709 limited-range conversion and yuv420p', () => {
    assert.deepEqual(finishingFilters(undefined, 'h264'), ['format=gbrp16le', bt709Scale, 'format=yuv420p']);
    assert.deepEqual(finishingFilters(undefined, 'hevc'), ['format=gbrp16le', bt709Scale, 'format=yuv420p']);
  });

  it('feeds prores yuv422p10le', () => {
    assert.deepEqual(finishingFilters(undefined, 'prores'), ['format=gbrp16le', bt709Scale, 'format=yuv422p10le']);
  });

  it('with a full grade applies the quoted cube, the vignette in rgb24, the seeded grain in gbrp, then the conversion', () => {
    assert.deepEqual(finishingFilters(grade, 'h264'), [
      'format=gbrp16le',
      `lut3d=file=${quotedCube}:interp=tetrahedral`,
      'format=rgb24',
      'vignette=angle=PI/8',
      'format=gbrp',
      'noise=all_seed=7:all_strength=6:all_flags=t+u',
      bt709Scale,
      'format=yuv420p',
    ]);
  });

  it('skips the LUT for a null cube and the vignette and grain when their amounts are 0', () => {
    assert.deepEqual(finishingFilters({ ...grade, cubePath: null, vignetteAmount: 0, grainAmount: 0 }, 'prores'), ['format=gbrp16le', bt709Scale, 'format=yuv422p10le']);
  });
});

describe('vignetteFilter', () => {
  it('maps the amount onto the lens angle from PI/12 at 0+ to PI/4 at 1, skipping 0', () => {
    assert.equal(vignetteFilter(0), undefined);
    assert.equal(vignetteFilter(-1), undefined);
    assert.equal(vignetteFilter(0.25), 'vignette=angle=PI/10');
    assert.equal(vignetteFilter(0.5), 'vignette=angle=PI/8');
    assert.equal(vignetteFilter(0.3), 'vignette=angle=PI/9.6');
    assert.equal(vignetteFilter(1), 'vignette=angle=PI/4');
    assert.equal(vignetteFilter(5), 'vignette=angle=PI/4');
  });
});

describe('grainFilter', () => {
  it('rounds the amount times 40 to the noise strength and keeps the seed', () => {
    assert.equal(grainFilter(0, 7), undefined);
    assert.equal(grainFilter(0.01, 7), undefined);
    assert.equal(grainFilter(0.15, 7), 'noise=all_seed=7:all_strength=6:all_flags=t+u');
    assert.equal(grainFilter(1, 123), 'noise=all_seed=123:all_strength=40:all_flags=t+u');
    assert.equal(grainFilter(3, 1), 'noise=all_seed=1:all_strength=40:all_flags=t+u');
  });
});

describe('colorTagArguments', () => {
  it('tags BT.709 primaries, transfer and matrix with limited range', () => {
    assert.deepEqual(colorTagArguments(), ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv']);
  });
});
