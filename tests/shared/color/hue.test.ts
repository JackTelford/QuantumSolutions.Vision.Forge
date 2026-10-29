import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hexToRgb255, hueDegrees, hueDeltaDegrees, saturation } from '../../../src/shared/color/hue.ts';

describe('hueDegrees', () => {
  it('puts the sRGB primaries and secondaries on the hexcone at 60 degree steps', () => {
    assert.equal(hueDegrees({ r: 255, g: 0, b: 0 }), 0);
    assert.equal(hueDegrees({ r: 255, g: 255, b: 0 }), 60);
    assert.equal(hueDegrees({ r: 0, g: 255, b: 0 }), 120);
    assert.equal(hueDegrees({ r: 0, g: 255, b: 255 }), 180);
    assert.equal(hueDegrees({ r: 0, g: 0, b: 255 }), 240);
    assert.equal(hueDegrees({ r: 255, g: 0, b: 255 }), 300);
  });

  it('gives the 80 percent swatches of the calibration scene the same hues as the full primaries', () => {
    assert.equal(hueDegrees(hexToRgb255('#cc0000')), 0);
    assert.equal(hueDegrees(hexToRgb255('#00cc00')), 120);
    assert.equal(hueDegrees(hexToRgb255('#0000cc')), 240);
    assert.equal(hueDegrees(hexToRgb255('#cc00cc')), 300);
  });

  it('reports 0 for a gray, which has no hue', () => {
    assert.equal(hueDegrees({ r: 118, g: 118, b: 118 }), 0);
    assert.equal(hueDegrees({ r: 0, g: 0, b: 0 }), 0);
  });

  it('interpolates inside a sector: orange sits at 30 degrees', () => {
    assert.ok(Math.abs(hueDegrees({ r: 255, g: 128, b: 0 }) - 30.1) < 0.1);
  });
});

describe('saturation', () => {
  it('is 1 for a pure hue, 0 for a gray and for black, and in between for a tinted gray', () => {
    assert.equal(saturation({ r: 204, g: 0, b: 0 }), 1);
    assert.equal(saturation({ r: 118, g: 118, b: 118 }), 0);
    assert.equal(saturation({ r: 0, g: 0, b: 0 }), 0);
    assert.equal(saturation({ r: 200, g: 100, b: 100 }), 0.5);
  });
});

describe('hueDeltaDegrees', () => {
  it('takes the shortest way round the circle, signed', () => {
    assert.equal(hueDeltaDegrees(0, 30), 30);
    assert.equal(hueDeltaDegrees(30, 0), -30);
    assert.equal(hueDeltaDegrees(350, 10), 20);
    assert.equal(hueDeltaDegrees(10, 350), -20);
    assert.equal(hueDeltaDegrees(120, 120), 0);
  });

  it('names a half turn as +180', () => {
    assert.equal(hueDeltaDegrees(0, 180), 180);
    assert.equal(hueDeltaDegrees(180, 0), 180);
  });
});

describe('hexToRgb255', () => {
  it('reads a #rrggbb colour into channels from 0 to 255', () => {
    assert.deepEqual(hexToRgb255('#767676'), { r: 118, g: 118, b: 118 });
    assert.deepEqual(hexToRgb255('#cc00cc'), { r: 204, g: 0, b: 204 });
  });

  it('refuses anything that is not a #rrggbb colour', () => {
    assert.throws(() => hexToRgb255('red'), RangeError);
  });
});
