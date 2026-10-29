import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PatchMeasurement, SwatchHueMeasurement } from '../../src/calibration/measure.ts';
import { formatNumber, formatRgb, hueTable, markdownTable, notVerifiedSection, patchSummary, patchTable } from '../../src/calibration/report.ts';

const patches: readonly PatchMeasurement[] = [
  { id: 'gray-18', hex: '#767676', expectedYavg: 117.3, tolerance: 5, measuredYavg: 118.04, delta: 0.74, ok: true, meanRgb: { r: 125, g: 115, b: 109 } },
  { id: 'white-90', hex: '#f3f3f3', expectedYavg: 224.7, tolerance: 10, measuredYavg: 236.6, delta: 11.9, ok: false, meanRgb: { r: 243, g: 243, b: 243 } },
  { id: 'black-2', hex: '#272727', expectedYavg: 49.5, tolerance: 10, measuredYavg: null, delta: null, ok: false, meanRgb: { r: 0, g: 0, b: 0 } },
];

const hues: readonly SwatchHueMeasurement[] = [
  { id: 'swatch-red', hex: '#cc0000', expectedHueDeg: 0, rgb: { r: 180, g: 40, b: 30 }, measuredHueDeg: 4, deltaDeg: 4, saturation: 0.8333 },
  { id: 'swatch-blue', hex: '#0000cc', expectedHueDeg: 240, rgb: { r: 20, g: 30, b: 150 }, measuredHueDeg: 235.38, deltaDeg: -4.62, saturation: 0.8667 },
];

describe('the calibration report formatting', () => {
  it('formats a patch table with one row per patch, deltas signed, unmeasured patches as n/a, the mean colour last', () => {
    const expected = [
      '| Patch | Hex | Expected YAVG | Measured YAVG | Delta | Tolerance | Ok | Mean RGB |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| gray-18 | #767676 | 117.3 | 118.0 | +0.7 | ±5 | yes | 125, 115, 109 |',
      '| white-90 | #f3f3f3 | 224.7 | 236.6 | +11.9 | ±10 | no | 243, 243, 243 |',
      '| black-2 | #272727 | 49.5 | n/a | n/a | ±10 | no | 0, 0, 0 |',
    ].join('\n');
    assert.equal(patchTable(patches), expected);
  });

  it('writes a colour as three whole code values separated by commas', () => {
    assert.equal(formatRgb({ r: 204, g: 0, b: 7 }), '204, 0, 7');
  });

  it('formats a hue table with the mean colour, both hues, the signed turn and the saturation', () => {
    const expected = [
      '| Swatch | Hex | Mean RGB | Expected hue | Measured hue | Hue delta | Saturation |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| swatch-red | #cc0000 | 180, 40, 30 | 0° | 4.0° | +4.0° | 0.83 |',
      '| swatch-blue | #0000cc | 20, 30, 150 | 240° | 235.4° | -4.6° | 0.87 |',
    ].join('\n');
    assert.equal(hueTable(hues), expected);
  });

  it('is deterministic: the same inputs give the same text twice', () => {
    assert.equal(patchTable(patches), patchTable(patches.map((row) => ({ ...row }))));
    assert.equal(hueTable(hues), hueTable([...hues]));
  });

  it('sums a patch table up with the count inside tolerance and the gray card', () => {
    assert.equal(patchSummary(patches), '1 of 3 patches within tolerance; gray-18 118.0 (+0.7 against 117.3).');
    assert.equal(patchSummary([]), '0 of 0 patches within tolerance; no gray card measured.');
  });

  it('escapes pipes and flattens line breaks inside a cell', () => {
    assert.equal(markdownTable(['a', 'b'], [['x|y', 'two\nlines']]), '| a | b |\n| --- | --- |\n| x\\|y | two lines |');
  });

  it('formats numbers to the asked decimals, with a plus when signed', () => {
    assert.equal(formatNumber(1.25, 1), '1.3');
    assert.equal(formatNumber(0, 1, true), '+0.0');
    assert.equal(formatNumber(-2.5, 1, true), '-2.5');
    assert.equal(formatNumber(null, 2), 'n/a');
  });

  it('writes the Not verified section as a list, or the one sentence when nothing is left', () => {
    assert.equal(notVerifiedSection([]), '## Not verified\n\nNothing left unverified by this probe.\n');
    assert.equal(notVerifiedSection(['Linux', 'macOS']), '## Not verified\n\n- Linux\n- macOS\n');
  });
});
