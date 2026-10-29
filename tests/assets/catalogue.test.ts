import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogue, catalogueIds, findCatalogueEntry, hdriForLighting } from '../../src/assets/catalogue.ts';
import { isHostAllowed, networkAllowlist } from '../../src/net/allowlist.ts';
import { LightingPresetValues } from '../../src/shared/contracts/look-bible.ts';

describe('the asset catalogue', () => {
  it('lists ten HDRIs with unique ids of the form kind:name-res', () => {
    assert.equal(catalogue.length, 10);
    const ids = catalogueIds();
    assert.equal(new Set(ids).size, ids.length);
    for (const entry of catalogue) {
      assert.match(entry.id, /^hdri:[a-z0-9_]+-(1k|2k)$/, entry.id);
      assert.equal(entry.id, `${entry.kind}:${entry.name}-${entry.id.endsWith('-1k') ? '1k' : '2k'}`);
    }
  });

  it('pins every entry to an allowlisted https host with a 32-hex md5, a positive size and a file under assets/hdri/', () => {
    for (const entry of catalogue) {
      const url = new URL(entry.url);
      assert.equal(url.protocol, 'https:', entry.url);
      assert.ok(isHostAllowed(url.hostname, networkAllowlist), `${url.hostname} is not allowlisted`);
      assert.match(entry.md5, /^[0-9a-f]{32}$/, entry.id);
      assert.ok(Number.isInteger(entry.bytes) && entry.bytes > 0, entry.id);
      assert.ok(entry.file.startsWith('assets/hdri/') && entry.file.endsWith('.hdr') && !entry.file.includes('\\'), entry.file);
      assert.equal(entry.license, 'CC0-1.0');
      assert.match(entry.credit, /, Poly Haven \(CC0\)$/);
      assert.ok(entry.kelvin === null || entry.kelvin > 0);
      assert.ok(entry.tags.length > 0);
    }
  });

  it('records the Studio Small 09 1k pin as read from the Poly Haven file API', () => {
    const entry = findCatalogueEntry('hdri:studio_small_09-1k');
    assert.deepEqual(entry, {
      id: 'hdri:studio_small_09-1k',
      kind: 'hdri',
      name: 'studio_small_09',
      url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
      bytes: 1615248,
      md5: 'd5d7eb9d26d341d6aa4d11c1a54fd97c',
      license: 'CC0-1.0',
      credit: 'Studio Small 09 by Sergej Majboroda, Poly Haven (CC0)',
      file: 'assets/hdri/studio_small_09_1k.hdr',
      kelvin: 2750,
      description: 'Studio Small 09, 1k. Octaboxes on a white cyc: the neutral product studio.',
      tags: ['studio', 'softbox', 'product'],
    });
    assert.equal(findCatalogueEntry('hdri:nothing-1k'), undefined);
  });

  it('chooses an HDRI at both resolutions for every lighting preset of the vocabulary', () => {
    for (const preset of LightingPresetValues) {
      for (const resolution of ['1k', '2k'] as const) {
        const entry = hdriForLighting(preset, resolution);
        assert.ok(entry.id.endsWith(`-${resolution}`), `${preset} at ${resolution} gave ${entry.id}`);
        assert.ok(catalogue.includes(entry));
      }
    }
    assert.equal(hdriForLighting('product-studio', '1k').name, 'studio_small_09');
    assert.equal(hdriForLighting('window', '2k').name, 'brown_photostudio_02');
    assert.equal(hdriForLighting('low-key', '1k').name, 'studio_small_03');
    assert.equal(hdriForLighting('golden-hour', '1k').name, 'kloofendal_48d_partly_cloudy_puresky');
    assert.equal(hdriForLighting('neon-night', '1k').name, 'moonless_golf');
  });
});
