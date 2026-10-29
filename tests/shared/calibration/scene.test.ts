import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calibrationScene,
  expectedYavg,
  linearReflectanceToHex,
  linearToSrgbChannel,
  neutralYavgTolerance,
  swatchYavgTolerance,
} from '../../../src/shared/calibration/scene.ts';
import type { CalibrationPatch, CalibrationScene } from '../../../src/shared/calibration/scene.ts';

/** The scene's expected YAVG values are rounded to a tenth; the arithmetic must land within half of that rounding step of them. */
const yavgEpsilon = 0.05;
/** Slack for the sRGB transfer curve, which the ADR quotes to four decimals. */
const transferEpsilon = 0.0005;

/** The scene seen through its interface rather than its literal `as const` type, so the discriminated union narrows. */
const scene: CalibrationScene = calibrationScene;
const patches = scene.elements.filter((element): element is CalibrationPatch => element.kind === 'patch');

function patch(id: string): CalibrationPatch {
  const found = patches.find((element) => element.id === id);
  assert.ok(found !== undefined, `no patch ${id}`);
  return found;
}

describe('the sRGB transfer curve', () => {
  it('encodes 18 percent linear reflectance as 0.4614, not 0.4667 (#777777)', () => {
    assert.ok(Math.abs(linearToSrgbChannel(0.18) - 0.4614) <= transferEpsilon, `${linearToSrgbChannel(0.18)}`);
  });

  it('is the straight line 12.92 × L on the dark segment and reaches 1 at 1', () => {
    assert.ok(Math.abs(linearToSrgbChannel(0.001) - 0.01292) <= 1e-12);
    assert.ok(Math.abs(linearToSrgbChannel(1) - 1) <= 1e-12);
    assert.equal(linearToSrgbChannel(0), 0);
  });

  it('turns the 18 percent gray card into #767676 and the other neutrals into their codes', () => {
    assert.equal(linearReflectanceToHex(0.18), '#767676');
    assert.equal(linearReflectanceToHex(0.9), '#f3f3f3');
    assert.equal(linearReflectanceToHex(0.02), '#272727');
    assert.equal(linearReflectanceToHex(0), '#000000');
    assert.equal(linearReflectanceToHex(1), '#ffffff');
  });

  it('refuses a reflectance outside 0 to 1', () => {
    assert.throws(() => linearReflectanceToHex(1.2), RangeError);
    assert.throws(() => linearReflectanceToHex(-0.1), RangeError);
  });
});

describe('expectedYavg', () => {
  it('puts the gray card at 16 + 219 × 118 / 255, about 117.3', () => {
    assert.ok(Math.abs(expectedYavg('#767676') - 117.34) <= yavgEpsilon, `${expectedYavg('#767676')}`);
  });

  it('puts black at 16 and white at 235', () => {
    assert.ok(Math.abs(expectedYavg('#000000') - 16) <= 1e-9);
    assert.ok(Math.abs(expectedYavg('#ffffff') - 235) <= 1e-9);
  });

  it('weights the encoded channels by the BT.709 coefficients', () => {
    assert.ok(Math.abs(expectedYavg('#cc0000') - (16 + 219 * 0.2126 * 0.8)) <= 1e-9);
    assert.ok(Math.abs(expectedYavg('#00cc00') - (16 + 219 * 0.7152 * 0.8)) <= 1e-9);
    assert.ok(Math.abs(expectedYavg('#0000cc') - (16 + 219 * 0.0722 * 0.8)) <= 1e-9);
  });
});

describe('the calibration scene', () => {
  it('has the gray card, the white and black patches, six swatches, two spheres and a 48 px text line', () => {
    const kinds = scene.elements.map((element) => element.kind);
    assert.equal(kinds.filter((kind) => kind === 'patch').length, 9);
    assert.equal(kinds.filter((kind) => kind === 'sphere').length, 2);
    assert.equal(kinds.filter((kind) => kind === 'text').length, 1);
    const text = scene.elements.find((element) => element.kind === 'text');
    assert.equal(text?.kind === 'text' ? text.sizePx : undefined, 48);
    assert.equal(new Set(scene.elements.map((element) => element.id)).size, scene.elements.length);
  });

  it('colours each neutral patch from its linear reflectance', () => {
    for (const element of patches) {
      if (element.linearReflectance === null) continue;
      assert.equal(element.hex, linearReflectanceToHex(element.linearReflectance), element.id);
    }
    assert.equal(scene.background.hex, linearReflectanceToHex(scene.background.linearReflectance));
  });

  it('states each patch expectation within a twentieth of a code value of the arithmetic', () => {
    for (const element of patches) {
      assert.ok(Math.abs(element.expectedYavg - expectedYavg(element.hex)) <= yavgEpsilon, `${element.id}: ${element.expectedYavg} vs ${expectedYavg(element.hex)}`);
    }
  });

  it('gives only the gray card the gating tolerance of 5 and every other patch the wider one', () => {
    assert.equal(patch('gray-18').tolerance, 5);
    assert.equal(neutralYavgTolerance, 5);
    assert.ok(swatchYavgTolerance > neutralYavgTolerance);
    for (const element of patches) {
      if (element.id === 'gray-18') continue;
      assert.equal(element.tolerance, swatchYavgTolerance, element.id);
    }
  });

  it('keeps every element inside the title-safe area (the central 90 percent)', () => {
    for (const element of scene.elements) {
      const { x, y, w, h } = element.box;
      assert.ok(x >= 0.05 && x + w <= 0.95, `${element.id} horizontally`);
      assert.ok(y >= 0.05 && y + h <= 0.95, `${element.id} vertically`);
    }
  });

  it('stores each box as left and top, so no two elements overlap', () => {
    const boxes = scene.elements.map((element) => ({ id: element.id, ...element.box }));
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id === b.id) continue;
        const separated = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(separated, `${a.id} overlaps ${b.id}`);
      }
    }
    const gray = patch('gray-18').box;
    assert.ok(Math.abs(gray.x + gray.w / 2 - 0.5) <= 1e-9, 'the gray card is centred horizontally');
  });
});
