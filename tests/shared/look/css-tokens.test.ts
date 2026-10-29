import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lightingRigs } from '../../../src/shared/lighting/rigs.ts';
import { cssVariables, gradientStopPercent, hexToRgb, kelvinToRgb, lightingGradient, lightingGradientWithin, litGradientAngleDeg, lightScreenAngleDeg, normaliseDegrees, rgbaCss, rgbToHex, shadowOffset, sheenAngle, sheenColour, sheenGradient, tintByLight } from '../../../src/shared/look/css-tokens.ts';
import { lookBibleExample } from '../../schema/documents/examples.ts';

const palette = lookBibleExample.palette;
const studio = lightingRigs['product-studio'];

describe('kelvinToRgb', () => {
  it('is white near 6600 K, warm below it and cool above it', () => {
    assert.deepEqual(kelvinToRgb(6600), { r: 255, g: 255, b: 255 });
    const warm = kelvinToRgb(3200);
    assert.equal(warm.r, 255);
    assert.ok(warm.b < warm.g && warm.g < 230, `3200 K is amber: ${JSON.stringify(warm)}`);
    const cool = kelvinToRgb(12000);
    assert.equal(cool.b, 255);
    assert.ok(cool.r < cool.g && cool.g < 255, `12000 K is blue: ${JSON.stringify(cool)}`);
    const candle = kelvinToRgb(1900);
    assert.equal(candle.b, 0);
  });

  it('clamps the temperature to the fitted range and every channel to a byte', () => {
    assert.deepEqual(kelvinToRgb(100), kelvinToRgb(1000));
    assert.deepEqual(kelvinToRgb(100000), kelvinToRgb(40000));
    for (const kelvin of [1000, 2500, 5600, 9000, 40000]) {
      const rgb = kelvinToRgb(kelvin);
      for (const channel of [rgb.r, rgb.g, rgb.b]) assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, `${kelvin} K`);
    }
  });
});

describe('colour helpers', () => {
  it('round-trip hex and channels and write rgba with two decimals', () => {
    assert.deepEqual(hexToRgb('#c9a84c'), { r: 201, g: 168, b: 76 });
    assert.equal(rgbToHex({ r: 201, g: 168, b: 76 }), '#c9a84c');
    assert.equal(rgbToHex({ r: 300, g: -5, b: 7.6 }), '#ff0008');
    assert.equal(rgbaCss('#0b0b0f', 0.6), 'rgba(11, 11, 15, 0.60)');
    assert.equal(rgbaCss('#ffffff', 2), 'rgba(255, 255, 255, 1.00)');
  });

  it('tint white by a light: amber for a 3200 K key, the neon colour for a tinted rim', () => {
    const amber = tintByLight('#ffffff', { azimuthDeg: 0, elevationDeg: 0, sizeM: 1, kelvin: 3200, intensity: 1, tint: null });
    assert.equal(amber, rgbToHex(kelvinToRgb(3200)));
    const neon = tintByLight('#ffffff', { azimuthDeg: 0, elevationDeg: 0, sizeM: 1, kelvin: 6500, intensity: 1, tint: '#ff2bd6' });
    assert.equal(neon, '#ff2bd6');
  });

  it('fold angles into [0, 360)', () => {
    assert.equal(normaliseDegrees(405), 45);
    assert.equal(normaliseDegrees(-90), 270);
    assert.equal(normaliseDegrees(360), 0);
  });
});

describe('cssVariables', () => {
  it('lists the six palette colours and the two font families under --vf- names', () => {
    const variables = cssVariables(lookBibleExample);
    assert.equal(variables.length, 8);
    assert.deepEqual(variables[0], ['--vf-background', '#0b0b0f']);
    assert.deepEqual(variables.find(([name]) => name === '--vf-font-display'), ['--vf-font-display', "'Playfair Display'"]);
    assert.deepEqual(variables.find(([name]) => name === '--vf-font-body'), ['--vf-font-body', "'Inter'"]);
    assert.ok(variables.every(([name]) => name.startsWith('--vf-')));
  });
});

describe('lightingGradient', () => {
  it('puts the lit side at the key: a key at camera-right (azimuth 90) runs the gradient from right to left', () => {
    assert.equal(lightScreenAngleDeg(lightingRigs.split, 0), 90);
    assert.equal(litGradientAngleDeg(lightingRigs.split, 0), 270);
    assert.equal(lightingGradient(lightingRigs.split, palette, 0), `linear-gradient(270.00deg, ${palette.surface} 0.00%, ${palette.background} 45.00%)`);
  });

  it('softens the transition as the fill rises: 85 percent at 1:1, 45 at 8:1 and beyond, 65 half way', () => {
    assert.equal(gradientStopPercent(1), 85);
    assert.equal(gradientStopPercent(8), 45);
    assert.equal(gradientStopPercent(16), 45);
    assert.equal(gradientStopPercent(4.5), 65);
    assert.equal(gradientStopPercent(0.5), 85);
  });

  it('follows the key-light orbit frame by frame and folds past 360', () => {
    assert.equal(litGradientAngleDeg(studio, 0), 225);
    assert.equal(litGradientAngleDeg(studio, 90), 315);
    assert.equal(litGradientAngleDeg(studio, 180), 45);
    assert.match(lightingGradient(studio, palette, 30), /^linear-gradient\(255\.00deg, #16161d 0\.00%, #0b0b0f 73\.57%\)$/);
  });

  it('confines the fade to a window of the line: the surface before it, the background after, the stop scaled into the span', () => {
    assert.equal(lightingGradientWithin(lightingRigs.split, palette, 0, 37.5, 25), `linear-gradient(270.00deg, ${palette.surface} 37.50%, ${palette.background} 48.75%)`);
    assert.equal(lightingGradientWithin(studio, palette, 0, 0, 100), lightingGradient(studio, palette, 0));
  });

  it('draws a keyless rig from its first rim, and practical-glow from behind the subject', () => {
    assert.equal(lightScreenAngleDeg(lightingRigs['contre-jour'], 0), 180);
    assert.equal(lightScreenAngleDeg(lightingRigs['practical-glow'], 0), 180);
  });
});

describe('shadowOffset', () => {
  it('points away from the light: down-left for a key at the upper right, straight down for a key behind the camera', () => {
    const offset = shadowOffset(studio, 10);
    assert.ok(offset.x < -7 && offset.y > 7, `away from azimuth 45: ${JSON.stringify(offset)}`);
    const butterfly = shadowOffset(lightingRigs.butterfly, 10);
    assert.ok(Math.abs(butterfly.x) < 1e-9 && Math.abs(butterfly.y - 10) < 1e-9);
    const side = shadowOffset(lightingRigs.split, 10);
    assert.ok(Math.abs(side.x + 10) < 1e-9 && Math.abs(side.y) < 1e-9, 'a key at camera-right casts left');
  });

  it('keeps its length and turns with the orbit', () => {
    const turned = shadowOffset(studio, 10, 45);
    assert.ok(Math.abs(Math.hypot(turned.x, turned.y) - 10) < 1e-9);
    assert.ok(Math.abs(turned.x + 10) < 1e-9, 'azimuth 45 plus 45 is camera-right');
  });
});

describe('the sheen', () => {
  it('shares the backdrop angle and tints the highlight by the key', () => {
    assert.equal(sheenAngle(studio, 0), litGradientAngleDeg(studio, 0));
    assert.equal(sheenColour(studio, '#ffffff'), rgbToHex(kelvinToRgb(5600)));
    assert.equal(sheenColour(lightingRigs['neon-night'], '#ffffff'), '#ff2bd6');
    assert.equal(sheenColour({ ...lightingRigs['practical-glow'], rims: [] }, '#ffffff'), '#ffffff');
  });

  it('is a gradient from 35 percent of the tinted highlight to clear', () => {
    const sheen = sheenGradient(studio, palette, 0);
    assert.match(sheen, /^linear-gradient\(225\.00deg, rgba\(\d+, \d+, \d+, 0\.35\) 0%, rgba\(\d+, \d+, \d+, 0\.00\) 60%\)$/);
  });
});
