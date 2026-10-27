import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { applyGrade, cubeSizeRange, cubeTitle, generateCube, identityGrade } from '../../../src/shared/grade/grade.ts';
import type { GradeParameters } from '../../../src/shared/grade/grade.ts';
import { filterPath, findFfmpeg, runFfmpeg } from '../../../src/tools/ffmpeg.ts';
import { compare, never, runner } from '../../assemble/support.ts';

const ffmpeg = findFfmpeg();

function cubeLines(text: string): { readonly header: readonly string[]; readonly rows: readonly string[] } {
  const lines = text.split('\n').filter((line) => line.length > 0);
  return { header: lines.slice(0, 4), rows: lines.slice(4) };
}

function withGrade(changes: Partial<GradeParameters>): GradeParameters {
  return { ...identityGrade, ...changes };
}

describe('applyGrade', () => {
  it('leaves a value unchanged under the identity grade', () => {
    assert.deepEqual(applyGrade([0.2, 0.5, 0.8], identityGrade), [0.2, 0.5, 0.8]);
  });

  it('doubles a midpoint with gain 2 before clamping and clamps a value that would exceed 1', () => {
    const gain2 = withGrade({ gain: { r: 2, g: 2, b: 2 } });
    assert.deepEqual(applyGrade([0.25, 0.25, 0.25], gain2), [0.5, 0.5, 0.5]);
    assert.deepEqual(applyGrade([0.75, 0.75, 0.75], gain2), [1, 1, 1]);
  });

  it('applies lift, gamma and gain per channel as ASC CDL offset, power and slope, so gamma 2 darkens the midtones', () => {
    const grade = withGrade({ lift: { r: 0.1, g: 0, b: 0 }, gamma: { r: 1, g: 2, b: 1 }, gain: { r: 1, g: 1, b: 0.5 } });
    const [r, g, b] = applyGrade([0.4, 0.25, 0.8], grade);
    assert.ok(Math.abs(r - 0.5) < 1e-12, `r ${r}`);
    assert.ok(Math.abs(g - 0.0625) < 1e-12, `g ${g}`);
    assert.ok(Math.abs(b - 0.4) < 1e-12, `b ${b}`);
    const [, brighter] = applyGrade([0.25, 0.25, 0.25], withGrade({ gamma: { r: 1, g: 0.5, b: 1 } }));
    assert.ok(Math.abs(brighter - 0.5) < 1e-12, `g ${brighter}`);
  });

  it('turns saturation 0 into the Rec. 709 luma on every channel', () => {
    const [r, g, b] = applyGrade([1, 0, 0], withGrade({ saturation: 0 }));
    assert.equal(r, g);
    assert.equal(g, b);
    assert.ok(Math.abs(r - 0.2126) < 1e-12);
  });

  it('scales contrast around the pivot', () => {
    const [r] = applyGrade([0.7, 0.7, 0.7], withGrade({ contrast: 2, contrastPivot: 0.5 }));
    assert.ok(Math.abs(r - 0.9) < 1e-12, `r ${r}`);
    const [pivot] = applyGrade([0.5, 0.5, 0.5], withGrade({ contrast: 2, contrastPivot: 0.5 }));
    assert.ok(Math.abs(pivot - 0.5) < 1e-12);
  });

  it('tints shadows without touching highlights, and the other way round', () => {
    const shadows = withGrade({ splitTone: { shadowHue: 220, shadowAmount: 0.3, highlightHue: 40, highlightAmount: 0 } });
    const dark = applyGrade([0.2, 0.2, 0.2], shadows);
    assert.ok(dark[2] > dark[0], `shadow tint at hue 220 should push blue above red: ${dark.join(', ')}`);
    assert.deepEqual(applyGrade([0.9, 0.9, 0.9], shadows), [0.9, 0.9, 0.9]);
    const highlights = withGrade({ splitTone: { shadowHue: 220, shadowAmount: 0, highlightHue: 40, highlightAmount: 0.3 } });
    const bright = applyGrade([0.9, 0.9, 0.9], highlights);
    assert.ok(bright[0] > bright[2], `highlight tint at hue 40 should push red above blue: ${bright.join(', ')}`);
    assert.deepEqual(applyGrade([0.2, 0.2, 0.2], highlights), [0.2, 0.2, 0.2]);
  });
});

describe('generateCube', () => {
  it('writes the header and size³ rows with red varying fastest, and the identity grade maps every grid point to itself', () => {
    const size = 5;
    const { header, rows } = cubeLines(generateCube(identityGrade, size));
    assert.deepEqual(header, [`TITLE "${cubeTitle}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0']);
    assert.equal(rows.length, size ** 3);
    let index = 0;
    for (let b = 0; b < size; b += 1) {
      for (let g = 0; g < size; g += 1) {
        for (let r = 0; r < size; r += 1) {
          const expected = `${(r / (size - 1)).toFixed(6)} ${(g / (size - 1)).toFixed(6)} ${(b / (size - 1)).toFixed(6)}`;
          assert.equal(rows[index], expected, `row ${index}`);
          index += 1;
        }
      }
    }
  });

  it('defaults to 33 points per axis and ends with one newline', () => {
    const text = generateCube(identityGrade);
    assert.equal(cubeLines(text).rows.length, 33 ** 3);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
    assert.doesNotMatch(text, /\r/);
  });

  it('gives equal r, g and b on every row for saturation 0', () => {
    const { rows } = cubeLines(generateCube(withGrade({ saturation: 0 }), 9));
    for (const row of rows) {
      const [r, g, b] = row.split(' ');
      assert.equal(r, g, row);
      assert.equal(g, b, row);
    }
  });

  it('doubles the midpoint row for gain 2', () => {
    const size = 5;
    const { rows } = cubeLines(generateCube(withGrade({ gain: { r: 2, g: 2, b: 2 } }), size));
    const mid = 1;
    const row = rows[mid + mid * size + mid * size * size];
    assert.equal(row, '0.500000 0.500000 0.500000');
  });

  it('is the same text for the same grade, and refuses sizes outside the format', () => {
    assert.equal(generateCube(withGrade({ contrast: 1.2 }), 7), generateCube(withGrade({ contrast: 1.2 }), 7));
    assert.throws(() => generateCube(identityGrade, cubeSizeRange.min - 1), RangeError);
    assert.throws(() => generateCube(identityGrade, 4.5), RangeError);
  });
});

describe('generateCube through ffmpeg lut3d', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-cube-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('passes a testsrc2 frame through the identity cube with PSNR of at least 50 dB', async () => {
    if (ffmpeg === undefined) return;
    const cube = join(dir, 'identity.cube');
    writeFileSync(cube, generateCube(identityGrade), 'utf8');
    const source = join(dir, 'source.png');
    const graded = join(dir, 'graded.png');
    await runFfmpeg(runner, ffmpeg.path, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1', '-frames:v', '1', source], { label: 'ffmpeg (test)' }, never);
    await runFfmpeg(runner, ffmpeg.path, ['-y', '-loglevel', 'error', '-i', source, '-vf', `format=gbrp16le,lut3d=file=${filterPath(cube)}:interp=tetrahedral,format=rgb24`, graded], { label: 'ffmpeg (test)' }, never);
    const { psnr } = await compare(ffmpeg.path, source, graded);
    assert.ok(psnr >= 50, `PSNR ${psnr} dB`);
  });
});
