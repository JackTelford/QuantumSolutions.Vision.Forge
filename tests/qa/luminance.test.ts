import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contrastRatio, isHexColor, relativeLuminanceOfHex, relativeLuminanceOfLuma } from '../../src/qa/luminance.ts';

const near = (actual: number, expected: number, tolerance: number): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} within ${tolerance} of ${expected}`);
};

describe('luminance and contrast', () => {
  it('accepts six-digit hex colours only', () => {
    assert.equal(isHexColor('#000000'), true);
    assert.equal(isHexColor('#AbCdEf'), true);
    assert.equal(isHexColor('#fff'), false);
    assert.equal(isHexColor('ffffff'), false);
    assert.equal(isHexColor('#gggggg'), false);
  });

  it('linearizes sRGB hex with the WCAG transfer function', () => {
    assert.equal(relativeLuminanceOfHex('#ffffff'), 1);
    assert.equal(relativeLuminanceOfHex('#000000'), 0);
    near(relativeLuminanceOfHex('#808080'), 0.2158, 0.001);
    near(relativeLuminanceOfHex('#ff0000'), 0.2126, 0.0001);
    assert.ok(Number.isNaN(relativeLuminanceOfHex('red')));
  });

  it('maps limited-range luma to relative luminance with a 2.2 power curve, clamped', () => {
    assert.equal(relativeLuminanceOfLuma(235), 1);
    assert.equal(relativeLuminanceOfLuma(16), 0);
    assert.equal(relativeLuminanceOfLuma(0), 0);
    assert.equal(relativeLuminanceOfLuma(255), 1);
    near(relativeLuminanceOfLuma(126), 0.2198, 0.001);
  });

  it('computes the WCAG ratio in either order', () => {
    assert.equal(contrastRatio(1, 0), 21);
    assert.equal(contrastRatio(0, 1), 21);
    assert.equal(contrastRatio(0.5, 0.5), 1);
    near(contrastRatio(relativeLuminanceOfLuma(126), relativeLuminanceOfHex('#808080')), 1.015, 0.01);
  });
});
