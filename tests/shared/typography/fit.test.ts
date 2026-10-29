import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LookBible } from '../../../src/shared/contracts/look-bible.ts';
import { estimateLines, estimateTextWidthPx, fitTextSize, linesHeightPx, wrapText } from '../../../src/shared/typography/fit.ts';
import { roleSizePx } from '../../../src/shared/typography/scale.ts';

const typography: LookBible['typography'] = { display: 'playfair-display', body: 'inter', scaleRatio: 1.25, displayTrackingEm: -0.02, uppercaseTrackingEm: 0.08 };

describe('wrapText', () => {
  const measure = (text: string): number => text.length * 10;

  it('keeps words together while they fit and breaks before the word that does not', () => {
    assert.deepEqual(wrapText('one two three four', 90, measure), ['one two', 'three', 'four']);
  });

  it('lets a word wider than the line stand alone and honours explicit newlines', () => {
    assert.deepEqual(wrapText('extraordinarily long\nnext', 50, measure), ['extraordinarily', 'long', 'next']);
    assert.deepEqual(wrapText('', 50, measure), ['']);
  });
});

describe('estimateTextWidthPx', () => {
  it('scales with the character count, the family, the weight, the tracking and capitals', () => {
    assert.equal(estimateTextWidthPx('abcd', 100, 'inter', 400, 0, false), 200);
    assert.equal(estimateTextWidthPx('abcd', 100, 'jetbrains-mono', 400, 0, false), 240);
    assert.ok(estimateTextWidthPx('abcd', 100, 'inter', 800, 0, false) > 200);
    assert.ok(estimateTextWidthPx('abcd', 100, 'inter', 400, 0.08, false) > 200);
    assert.ok(estimateTextWidthPx('abcd', 100, 'inter', 400, 0, true) > 200);
  });
});

describe('fitTextSize', () => {
  it('keeps the scale size when the text fits its box', () => {
    const fit = fitTextSize('Now', 'title', 1200, 400, typography, 1080, 72);
    assert.equal(fit.fontSizePx, roleSizePx('title', 1.25, 1080));
    assert.deepEqual(fit.lines, ['Now']);
    assert.equal(fit.fits, true);
  });

  it('shrinks a title that would wrap out of its box until one line fits, and stays above the floor', () => {
    const fit = fitTextSize('Now in 500 ml', 'title', 768, 129.6, typography, 1080, 72);
    assert.ok(fit.fontSizePx < fit.scaleSizePx, 'shrunk');
    assert.ok(fit.fontSizePx >= 72, 'above the floor');
    assert.equal(fit.lines.length, 1);
    assert.equal(fit.fits, true);
    assert.ok(linesHeightPx('title', fit.fontSizePx, 1) <= 129.6);
  });

  it('reports a box that cannot hold the text even at the floor', () => {
    const fit = fitTextSize('A very long title that cannot possibly fit', 'title', 200, 40, typography, 1080, 72);
    assert.equal(fit.fontSizePx, 72);
    assert.equal(fit.fits, false);
  });

  it('estimates lines at a size for the composition check', () => {
    assert.deepEqual(estimateLines('Now in 500 ml', 'title', 140, 768, typography), ['Now in 500', 'ml']);
    assert.deepEqual(estimateLines('Now in 500 ml', 'title', 100, 768, typography), ['Now in 500 ml']);
  });
});
