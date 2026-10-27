import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contrastRatio, contrastRatioOfLuminances, parseHexColour, relativeLuminance, srgbLinearThreshold } from '../../src/shared/color/contrast.ts';

/** Rounds to six decimals, enough to compare against published WCAG figures without floating-point noise. */
function rounded(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    assert.equal(relativeLuminance('#000000'), 0);
    assert.equal(rounded(relativeLuminance('#ffffff')), 1);
  });

  it('matches the WCAG figure for mid-gray (#808080 is 0.215861)', () => {
    assert.equal(rounded(relativeLuminance('#808080')), 0.215861);
  });

  it('weights the channels 0.2126, 0.7152 and 0.0722', () => {
    assert.equal(rounded(relativeLuminance('#ff0000')), 0.2126);
    assert.equal(rounded(relativeLuminance('#00ff00')), 0.7152);
    assert.equal(rounded(relativeLuminance('#0000ff')), 0.0722);
  });

  it('uses the linear segment at or below 0.04045 and the power curve above it', () => {
    assert.equal(srgbLinearThreshold, 0.04045);
    const below = 10 / 255;
    assert.ok(below <= srgbLinearThreshold);
    assert.equal(rounded(relativeLuminance('#0a0a0a')), rounded(below / 12.92));
    const above = 11 / 255;
    assert.ok(above > srgbLinearThreshold);
    assert.equal(rounded(relativeLuminance('#0b0b0b')), rounded(((above + 0.055) / 1.055) ** 2.4));
  });

  it('accepts uppercase hex digits and rejects anything that is not #rrggbb', () => {
    assert.equal(relativeLuminance('#FFFFFF'), relativeLuminance('#ffffff'));
    for (const bad of ['#fff', 'ffffff', '#gggggg', '#ffffff ', '', 'white']) {
      assert.throws(() => relativeLuminance(bad), (error: unknown) => error instanceof RangeError && error.message === `"${bad}" is not a #rrggbb colour.`, bad);
    }
  });
});

describe('parseHexColour', () => {
  it('returns the three channels as fractions of 255', () => {
    assert.deepEqual(parseHexColour('#ff8000'), [1, 128 / 255, 0]);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, the WCAG example', () => {
    assert.equal(rounded(contrastRatio('#000000', '#ffffff')), 21);
  });

  it('is 1 for a colour on itself', () => {
    assert.equal(rounded(contrastRatio('#c9a84c', '#c9a84c')), 1);
  });

  it('does not depend on which colour is the foreground', () => {
    assert.equal(contrastRatio('#0b0b0f', '#f4f1ea'), contrastRatio('#f4f1ea', '#0b0b0f'));
  });

  it('matches published figures: #767676 on white is 4.54, #808080 on white is 3.95', () => {
    assert.equal(Math.round(contrastRatio('#767676', '#ffffff') * 100) / 100, 4.54);
    assert.equal(Math.round(contrastRatio('#808080', '#ffffff') * 100) / 100, 3.95);
  });
});

describe('contrastRatioOfLuminances', () => {
  it('is the ratio the hex form uses: 21 between 0 and 1, 1 between equals, the same in either order', () => {
    assert.equal(rounded(contrastRatioOfLuminances(0, 1)), 21);
    assert.equal(rounded(contrastRatioOfLuminances(0.2158, 0.2158)), 1);
    assert.equal(contrastRatioOfLuminances(0.05, 0.9), contrastRatioOfLuminances(0.9, 0.05));
    assert.equal(contrastRatioOfLuminances(relativeLuminance('#767676'), relativeLuminance('#ffffff')), contrastRatio('#767676', '#ffffff'));
  });
});
