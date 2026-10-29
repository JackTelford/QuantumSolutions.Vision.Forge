import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  circleOfConfusionMm,
  cssPerspectivePx,
  horizontalFovDegrees,
  sensorHeightMm,
  sensorWidthMm,
  thinLens,
  verticalFovDegrees,
} from '../../../src/shared/camera/model.ts';
import { assertClose } from './fixtures.ts';

const wide = 16 / 9;
const tall = 9 / 16;
/** The lens table rounds its field-of-view column to whole degrees; a tenth covers the 50 mm row and three tenths the 24 mm row. */
const fovTableEpsilon50 = 0.1;
const fovTableEpsilon24 = 0.3;
const perspectiveEpsilonPx = 2;
const centimetre = 0.01;

describe('camera model', () => {
  it('keeps the 36 mm sensor on the larger image axis: 36 × 20.25 mm at 16:9 and 20.25 × 36 mm at 9:16', () => {
    assertClose(sensorWidthMm(wide), 36, 1e-12, 'landscape width');
    assertClose(sensorHeightMm(wide), 20.25, 1e-12, 'landscape height');
    assertClose(sensorWidthMm(tall), 20.25, 1e-12, 'portrait width');
    assertClose(sensorHeightMm(tall), 36, 1e-12, 'portrait height');
    assertClose(sensorHeightMm(1), 36, 1e-12, 'square');
  });

  it('matches the vertical field of view column of the lens table at 16:9', () => {
    assertClose(verticalFovDegrees(50, wide), 22.9, fovTableEpsilon50, '50 mm');
    assertClose(verticalFovDegrees(24, wide), 45.8, fovTableEpsilon24, '24 mm');
    assertClose(verticalFovDegrees(85, wide), 13.6, 0.1, '85 mm');
    assertClose(verticalFovDegrees(14, wide), 71.6, 0.6, '14 mm');
  });

  it('gives the horizontal field of view from the sensor width, wider than the vertical one in landscape', () => {
    assertClose(horizontalFovDegrees(50, wide), 39.6, 0.1, '50 mm horizontal');
    assert.ok(horizontalFovDegrees(50, wide) > verticalFovDegrees(50, wide));
    assertClose(horizontalFovDegrees(50, tall), verticalFovDegrees(50, wide), 1e-12, 'portrait horizontal equals landscape vertical');
  });

  it('derives the CSS perspective of 2667 px for 50 mm at 16:9 in a 1080 px viewport', () => {
    assertClose(cssPerspectivePx(50, wide, 1080), 2667, perspectiveEpsilonPx, 'perspective');
    assertClose(cssPerspectivePx(50, wide, 540), 2667 / 2, perspectiveEpsilonPx, 'half viewport');
  });

  it('computes the thin-lens depth of field for 85 mm at f/4 focused at 1 m: about 3 cm with the 0.03 mm circle, the table\'s 4.5 cm with 0.045 mm', () => {
    const lens = thinLens(85, 4, 1);
    assertClose(lens.apertureDiameterMm, 21.25, 1e-9, 'aperture');
    assertClose(lens.hyperfocalM, 60.29, 0.01, 'hyperfocal');
    assertClose(lens.nearM, 0.985, 0.001, 'near');
    assertClose(lens.farM, 1.015, 0.001, 'far');
    assertClose(lens.farM - lens.nearM, 0.030, 0.3 * centimetre, 'depth of field');
    const tableLens = thinLens(85, 4, 1, 0.045);
    assertClose(tableLens.farM - tableLens.nearM, 0.045, 0.3 * centimetre, 'depth of field per the lens table');
    assert.equal(circleOfConfusionMm, 0.03);
  });

  it('reports an infinite far limit at and beyond the hyperfocal distance', () => {
    const lens = thinLens(50, 8, 100);
    assert.ok(100 >= lens.hyperfocalM, `hyperfocal ${lens.hyperfocalM}`);
    assert.equal(lens.farM, Number.POSITIVE_INFINITY);
    assert.ok(lens.nearM > 0 && lens.nearM < 100);
  });
});
