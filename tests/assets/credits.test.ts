import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { creditsMarkdown } from '../../src/assets/credits.ts';
import type { AssetRecord } from '../../src/net/asset-ledger.ts';
import { bundledFonts, fontsSourceCommit } from '../../src/shared/typography/scale.ts';

const records: readonly AssetRecord[] = [
  {
    id: 'hdri:studio_small_09-1k',
    source: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
    finalUrl: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
    license: 'CC0-1.0',
    bytes: 1615248,
    sha256: 'b'.repeat(64),
    md5: 'd5d7eb9d26d341d6aa4d11c1a54fd97c',
    fetchedAt: '2026-10-29T12:00:00.000Z',
    credit: 'Studio Small 09 by Sergej Majboroda, Poly Haven (CC0)',
    files: ['assets/hdri/studio_small_09_1k.hdr'],
  },
  {
    id: 'hdri:moonless_golf-1k',
    source: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr',
    finalUrl: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr',
    license: 'CC0-1.0',
    bytes: 1672754,
    sha256: 'c'.repeat(64),
    fetchedAt: '2026-10-29T12:01:00.000Z',
    files: ['assets/hdri/moonless_golf_1k.hdr'],
  },
];

describe('creditsMarkdown', () => {
  it('starts with a heading and credits the four bundled fonts with their google/fonts source and commit', () => {
    const text = creditsMarkdown([]);
    assert.ok(text.startsWith('# Credits\n'));
    assert.ok(text.includes(`commit ${fontsSourceCommit}`));
    for (const font of Object.values(bundledFonts)) {
      assert.ok(text.includes(`| ${font.cssFamily} | ${font.file} | https://github.com/google/fonts/blob/${fontsSourceCommit}/${font.sourcePath} | OFL-1.1 |`), font.cssFamily);
    }
    assert.ok(text.includes('No assets have been downloaded.'));
    assert.ok(text.endsWith('\n'));
  });

  it('lists every ledger record sorted by id with its credit, license and source URL', () => {
    const text = creditsMarkdown(records);
    const golf = text.indexOf('- `hdri:moonless_golf-1k`: no attribution text. License CC0-1.0. Source: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr');
    const studio = text.indexOf('- `hdri:studio_small_09-1k`: Studio Small 09 by Sergej Majboroda, Poly Haven (CC0). License CC0-1.0. Source: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr');
    assert.ok(golf >= 0 && studio >= 0, text);
    assert.ok(golf < studio, 'sorted by id');
    assert.ok(!text.includes('No assets have been downloaded.'));
  });
});
