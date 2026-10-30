import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bt709Scale, clipGradeFilters, colorTagArguments, deliveryTailFilters, eightBitFormat, grainFilter, joinFormat, sixteenBitFormat, vignetteFilter } from '../../src/finishing/finishing-chain.ts';
import type { FinishingGrade } from '../../src/shared/contracts/assembly-plan.ts';

const grade: FinishingGrade = { cubePath: 'C:\\vf\\look\\film.cube', vignetteAmount: 0.5, vignetteSoftness: 0.6, grainAmount: 0.15, grainSeed: 7 };
const quotedCube = "'C\\:/vf/look/film.cube'";

describe('clipGradeFilters', () => {
  it('without a grade still takes the clip through 16-bit RGB, the path every graded clip and every calibration number took', () => {
    assert.deepEqual(clipGradeFilters(undefined), ['format=gbrp16le']);
    assert.equal(sixteenBitFormat, 'format=gbrp16le');
    assert.equal(eightBitFormat, 'format=gbrp');
  });

  it('with a full grade applies the quoted cube in 16-bit RGB then the vignette in rgb24, leaving the grain for the joined delivery', () => {
    assert.deepEqual(clipGradeFilters(grade), ['format=gbrp16le', `lut3d=file=${quotedCube}:interp=tetrahedral`, 'format=rgb24', 'vignette=angle=PI/8']);
    assert.equal(clipGradeFilters(grade).some((step) => step.startsWith('noise')), false);
  });

  it('skips the LUT for a null cube and the vignette when its amount is 0', () => {
    assert.deepEqual(clipGradeFilters({ ...grade, cubePath: null }), ['format=gbrp16le', 'format=rgb24', 'vignette=angle=PI/8']);
    assert.deepEqual(clipGradeFilters({ ...grade, vignetteAmount: 0 }), ['format=gbrp16le', `lut3d=file=${quotedCube}:interp=tetrahedral`]);
    assert.deepEqual(clipGradeFilters({ ...grade, cubePath: null, vignetteAmount: 0 }), ['format=gbrp16le']);
  });
});

describe('joinFormat', () => {
  it('keeps the join in 16-bit RGB for a vignette-free grade without text plates, so a LUT-only look and a prores master take the path ADR 0008 decision 3 measured', () => {
    assert.equal(joinFormat(undefined, false), 'format=gbrp16le');
    assert.equal(joinFormat({ ...grade, vignetteAmount: 0 }, false), 'format=gbrp16le');
    assert.equal(joinFormat({ ...grade, vignetteAmount: 0, grainAmount: 0.5 }, false), 'format=gbrp16le', 'grain lands after the join and drops to 8 bits there');
  });

  it('joins in 8-bit RGB once a vignette (rgb24 out) or a text plate (rgba overlay) is in the chain, as the single chain before the per-clip grade already did for a vignette', () => {
    assert.equal(joinFormat(grade, false), 'format=gbrp');
    assert.equal(joinFormat(undefined, true), 'format=gbrp');
    assert.equal(joinFormat({ ...grade, vignetteAmount: 0 }, true), 'format=gbrp');
  });
});

describe('deliveryTailFilters', () => {
  it('without a grade is the BT.709 limited-range conversion and the codec pixel format', () => {
    assert.deepEqual(deliveryTailFilters(undefined, 'h264'), [bt709Scale, 'format=yuv420p']);
    assert.deepEqual(deliveryTailFilters(undefined, 'hevc'), [bt709Scale, 'format=yuv420p']);
  });

  it('feeds prores yuv422p10le', () => {
    assert.deepEqual(deliveryTailFilters(undefined, 'prores'), [bt709Scale, 'format=yuv422p10le']);
  });

  it('with a grade drops the joined clips to 8-bit RGB for the seeded grain, text plates included, before the conversion', () => {
    assert.deepEqual(deliveryTailFilters(grade, 'h264'), ['format=gbrp', 'noise=all_seed=7:all_strength=6:all_flags=t+u:threads=1', bt709Scale, 'format=yuv420p']);
  });

  it('skips the grain when its amount is 0', () => {
    assert.deepEqual(deliveryTailFilters({ ...grade, grainAmount: 0 }, 'prores'), [bt709Scale, 'format=yuv422p10le']);
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
    assert.equal(grainFilter(0.15, 7), 'noise=all_seed=7:all_strength=6:all_flags=t+u:threads=1');
    assert.equal(grainFilter(1, 123), 'noise=all_seed=123:all_strength=40:all_flags=t+u:threads=1');
    assert.equal(grainFilter(3, 1), 'noise=all_seed=1:all_strength=40:all_flags=t+u:threads=1');
  });
});

describe('colorTagArguments', () => {
  it('tags BT.709 primaries, transfer and matrix with limited range', () => {
    assert.deepEqual(colorTagArguments(), ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv']);
  });
});
