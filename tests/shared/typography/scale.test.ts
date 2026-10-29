import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { textHeightFloorsPx } from '../../../src/shared/composition/checks.ts';
import type { LookBible } from '../../../src/shared/contracts/look-bible.ts';
import { FontFamilyValues } from '../../../src/shared/contracts/look-bible.ts';
import type { TextRole } from '../../../src/shared/contracts/shot-spec.ts';
import { TextRoleValues } from '../../../src/shared/contracts/shot-spec.ts';
import { bundledFonts, fontFaceCss, fontFacesToLoad, fontLicenseFile, fontsSourceCommit, roleFamily, roleSizePx, roleSizesPx, roleTrackingEm, roleUppercase, roleWeight } from '../../../src/shared/typography/scale.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fontsDir = join(repoRoot, 'skills', 'cinematic-studio', 'assets', 'fonts');
const typography: LookBible['typography'] = { display: 'playfair-display', body: 'inter', scaleRatio: 1.25, displayTrackingEm: -0.02, uppercaseTrackingEm: 0.08 };

describe('bundled fonts', () => {
  it('names every font family of the vocabulary once', () => {
    assert.deepEqual(Object.keys(bundledFonts).sort(), [...FontFamilyValues].sort());
  });

  it('ships each font file and its OFL text with the recorded SHA-256', () => {
    for (const font of Object.values(bundledFonts)) {
      const path = join(fontsDir, font.file);
      assert.ok(existsSync(path), `${font.file} is bundled`);
      assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), font.sha256, `${font.file} matches its pin`);
      const license = join(fontsDir, fontLicenseFile(font));
      assert.ok(existsSync(license), `${fontLicenseFile(font)} is bundled`);
      assert.match(readFileSync(license, 'utf8'), /SIL Open Font License/i);
      assert.equal(font.license, 'OFL-1.1');
      assert.match(font.sourcePath, /^ofl\//);
    }
    assert.match(fontsSourceCommit, /^[0-9a-f]{40}$/);
  });

  it('writes one @font-face per family with its weight range under the prefix', () => {
    const css = fontFaceCss('/fonts/');
    assert.equal(css.split('\n').length, 4);
    assert.match(css, /font-family: 'Inter'; src: url\('\/fonts\/Inter\.ttf'\) format\('truetype'\); font-weight: 100 900/);
    assert.match(css, /font-family: 'Space Grotesk'.*font-weight: 300 700/);
  });

  it('lists the faces a look needs, sorted and without duplicates', () => {
    const faces = fontFacesToLoad(typography);
    assert.deepEqual(faces, [...new Set(faces)].sort());
    assert.ok(faces.includes("700 16px 'Playfair Display'"));
    assert.ok(faces.includes("400 16px 'Inter'"));
    assert.ok(faces.every((face) => /^\d{3} 16px '[A-Za-z ]+'$/.test(face)));
  });
});

describe('role sizes', () => {
  it('covers every role', () => {
    assert.deepEqual(Object.keys(roleSizesPx).sort(), [...TextRoleValues].sort());
  });

  it('gives the reference sizes at 1080p: a 140 px title at 1.25 and 160 px at 1.333, a 32 px body', () => {
    assert.equal(roleSizePx('title', 1.25, 1080), 140);
    assert.equal(roleSizePx('title', 1.333, 1080), 160);
    assert.equal(roleSizePx('body', 1.25, 1080), 32);
    assert.equal(roleSizePx('subtitle', 1.333, 1080), 64);
  });

  it('doubles at 4K and halves at 540p, in whole pixels', () => {
    assert.equal(roleSizePx('title', 1.25, 2160), 280);
    assert.equal(roleSizePx('caption', 1.25, 540), 14);
  });

  it('clears the composition floor of every role at both ratios', () => {
    for (const role of TextRoleValues as readonly TextRole[]) {
      assert.ok(roleSizePx(role, 1.25, 1080) >= textHeightFloorsPx[role], `${role} at 1.25`);
      assert.ok(roleSizePx(role, 1.333, 1080) >= textHeightFloorsPx[role], `${role} at 1.333`);
    }
  });

  it('sets display roles in the display family and the rest in the body family', () => {
    assert.equal(roleFamily('title', typography), 'playfair-display');
    assert.equal(roleFamily('lower-third-name', typography), 'playfair-display');
    assert.equal(roleFamily('body', typography), 'inter');
    assert.equal(roleFamily('counter', typography), 'inter');
  });

  it('picks weights inside each family range', () => {
    assert.equal(roleWeight('title', 'inter'), 800);
    assert.equal(roleWeight('title', 'playfair-display'), 700);
    assert.equal(roleWeight('body', 'space-grotesk'), 400);
    assert.equal(roleWeight('subtitle', 'space-grotesk'), 500);
    for (const family of FontFamilyValues) {
      for (const role of TextRoleValues as readonly TextRole[]) {
        const weight = roleWeight(role, family);
        assert.ok(weight >= bundledFonts[family].minWeight && weight <= bundledFonts[family].maxWeight, `${role} in ${family}`);
      }
    }
  });

  it('tracks titles by the display tracking, capitals by the uppercase tracking, names by -0.01 em', () => {
    assert.equal(roleTrackingEm('title', typography), -0.02);
    assert.equal(roleTrackingEm('lower-third-title', typography), 0.08);
    assert.equal(roleTrackingEm('lower-third-name', typography), -0.01);
    assert.equal(roleTrackingEm('body', typography), 0);
    assert.equal(roleUppercase('lower-third-title'), true);
    assert.equal(roleUppercase('title'), false);
  });
});
