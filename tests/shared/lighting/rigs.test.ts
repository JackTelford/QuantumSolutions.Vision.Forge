import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Lighting } from '../../../src/shared/contracts/shot-spec.ts';
import { LightingPresetValues } from '../../../src/shared/contracts/shot-spec.ts';
import { applyLightingOverrides, dominantAzimuthDeg, lightingRigs, shotLightingRig } from '../../../src/shared/lighting/rigs.ts';

const overrides: Lighting = { preset: 'product-studio', keyIntensity: 1.5, fillRatio: 6, rimIntensity: 0.5, kelvin: 3200 };

describe('the lighting rigs', () => {
  it('cover the sixteen presets of the vocabulary, each under its own name', () => {
    assert.deepEqual(Object.keys(lightingRigs).sort(), [...LightingPresetValues].sort());
    for (const preset of LightingPresetValues) assert.equal(lightingRigs[preset].preset, preset);
  });

  it('transcribe the cookbook rows: product-studio, rembrandt, golden-hour and neon-rim', () => {
    const studio = lightingRigs['product-studio'];
    assert.deepEqual(studio.key, { azimuthDeg: 45, elevationDeg: 35, sizeM: 1.2, kelvin: 5600, intensity: 1, tint: null });
    assert.equal(studio.fillRatio, 3);
    assert.deepEqual(studio.rims, [{ azimuthDeg: 135, elevationDeg: 50, sizeM: 0.6, kelvin: 6500, intensity: 0.6, tint: null }]);
    assert.equal(lightingRigs.rembrandt.fillRatio, 8);
    assert.equal(lightingRigs.rembrandt.key?.kelvin, 5000);
    assert.equal(lightingRigs['golden-hour'].fill?.kelvin, 8000);
    assert.equal(lightingRigs['golden-hour'].fill?.azimuthDeg, null, 'an ambient fill has no position');
    assert.deepEqual(lightingRigs['soft-cross'].fill, { kelvin: 5600, azimuthDeg: 300 }, 'the second cross light is the fill, at 300 degrees');
    assert.equal(lightingRigs['golden-hour'].key?.kelvin, 3200);
    assert.equal(lightingRigs['neon-rim'].key?.intensity, 0.5);
    assert.equal(lightingRigs['neon-rim'].rims.length, 2);
    assert.notEqual(lightingRigs['neon-rim'].rims[0]?.tint, null);
  });

  it('give rim-only, contre-jour and practical-glow no key, and every other rig one', () => {
    const keyless = LightingPresetValues.filter((preset) => lightingRigs[preset].key === null);
    assert.deepEqual(keyless, ['rim-only', 'contre-jour', 'practical-glow']);
  });

  it('give high-key its extra stop and every other rig none', () => {
    for (const preset of LightingPresetValues) assert.equal(lightingRigs[preset].exposureEv, preset === 'high-key' ? 1 : 0);
  });

  it('keep every number in range: azimuths in [0, 360), elevations in [-90, 90], positive sizes, 1000 to 20000 K, intensities in [0, 1], fill ratios of at least 1', () => {
    for (const preset of LightingPresetValues) {
      const rig = lightingRigs[preset];
      const lights = rig.key === null ? rig.rims : [rig.key, ...rig.rims];
      for (const lightSource of lights) {
        assert.ok(lightSource.azimuthDeg >= 0 && lightSource.azimuthDeg < 360, `${preset} azimuth`);
        assert.ok(lightSource.elevationDeg >= -90 && lightSource.elevationDeg <= 90, `${preset} elevation`);
        assert.ok(lightSource.sizeM > 0, `${preset} size`);
        assert.ok(lightSource.kelvin >= 1000 && lightSource.kelvin <= 20000, `${preset} kelvin`);
        assert.ok(lightSource.intensity > 0 && lightSource.intensity <= 1, `${preset} intensity`);
        if (lightSource.tint !== null) assert.match(lightSource.tint, /^#[0-9a-f]{6}$/);
      }
      assert.ok(rig.fillRatio >= 1, `${preset} fill ratio`);
      assert.ok(rig.backdrop.length > 0 && rig.description.length > 0, `${preset} words`);
    }
  });
});

describe('applyLightingOverrides', () => {
  it('multiplies the key and the rims, replaces the fill ratio and the key kelvin, and leaves the fill kelvin', () => {
    const rig = applyLightingOverrides(lightingRigs['product-studio'], overrides);
    assert.equal(rig.key?.intensity, 1.5);
    assert.equal(rig.key?.kelvin, 3200);
    assert.equal(rig.fillRatio, 6);
    assert.equal(rig.rims[0]?.intensity, 0.3);
    assert.equal(rig.fill?.kelvin, 5600);
    assert.equal(rig.preset, 'product-studio');
  });

  it('leaves a keyless rig without a key and leaves the source rig untouched', () => {
    const before = structuredClone(lightingRigs['rim-only']);
    const rig = applyLightingOverrides(lightingRigs['rim-only'], { ...overrides, preset: 'rim-only' });
    assert.equal(rig.key, null);
    assert.equal(rig.rims[1]?.intensity, 0.5);
    assert.deepEqual(lightingRigs['rim-only'], before);
  });

  it('keeps a tinted key tinted, so the kelvin override does not recolour a neon rig', () => {
    const rig = applyLightingOverrides(lightingRigs['neon-night'], { ...overrides, preset: 'neon-night' });
    assert.equal(rig.key?.tint, '#ff2bd6');
    assert.equal(rig.key?.kelvin, 3200);
  });

  it('is the identity for the neutral overrides', () => {
    const neutral: Lighting = { preset: 'rembrandt', keyIntensity: 1, fillRatio: 8, rimIntensity: 1, kelvin: 5000 };
    assert.deepEqual(shotLightingRig(neutral), lightingRigs.rembrandt);
  });
});

describe('dominantAzimuthDeg', () => {
  it('is the key azimuth, the first rim without a key, and 180 without either', () => {
    assert.equal(dominantAzimuthDeg(lightingRigs.split), 90);
    assert.equal(dominantAzimuthDeg(lightingRigs['rim-only']), 135);
    assert.equal(dominantAzimuthDeg(lightingRigs['practical-glow']), 180);
  });
});
