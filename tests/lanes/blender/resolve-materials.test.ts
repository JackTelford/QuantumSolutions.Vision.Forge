import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calibrationPatchMaterial, calibrationSphereMaterial, principled, subjectMaterial, surfaceMaterial } from '../../../src/lanes/blender/materials.ts';
import { linearToSrgbChannel } from '../../../src/shared/calibration/scene.ts';
import { hexToLinearRgb, neutralLinearRgb, rgb255ToLinear, srgbToLinear } from '../../../src/shared/color/srgb.ts';
import { planLook } from '../../plan/fixtures.ts';
import { assertClose } from '../../shared/three/fixtures.ts';

describe('srgbToLinear', () => {
  it('decodes the sRGB curve: 0 and 1 unchanged, mid gray 0.5 to 0.214, and inverts linearToSrgbChannel', () => {
    assert.equal(srgbToLinear(0), 0);
    assert.equal(srgbToLinear(1), 1);
    assertClose(srgbToLinear(0.5), 0.2140, 1e-4, 'mid gray');
    for (const linear of [0.001, 0.02, 0.18, 0.5, 0.9]) assertClose(srgbToLinear(linearToSrgbChannel(linear)), linear, 1e-12, `round trip of ${String(linear)}`);
  });

  it('reads the 18 percent gray card #767676 as about 0.18 and a 255 channel as 1', () => {
    const gray = hexToLinearRgb('#767676');
    assertClose(gray.r, 0.18, 0.003, 'gray card');
    assert.deepEqual(rgb255ToLinear({ r: 255, g: 255, b: 255 }), { r: 1, g: 1, b: 1 });
    assert.deepEqual(neutralLinearRgb(0.18), { r: 0.18, g: 0.18, b: 0.18 });
  });
});

describe('the materials', () => {
  it('fills every Principled socket: opaque, IOR 1.45, no emission', () => {
    const material = principled('x', { r: 0.1, g: 0.2, b: 0.3 }, 0.4, 0.5, 0.6);
    assert.deepEqual(material, { name: 'x', baseColor: { r: 0.1, g: 0.2, b: 0.3 }, metallic: 0.5, roughness: 0.4, ior: 1.45, transmission: 0, coatWeight: 0.6, coatRoughness: 0.2, emissionColor: { r: 0, g: 0, b: 0 }, emissionStrength: 0 });
  });

  it('builds the body from the primary colour under a clear coat, the cap from the highlight, the surface rough, all in linear light', () => {
    const body = subjectMaterial('body', planLook.palette);
    assert.deepEqual([body.name, body.baseColor, body.roughness, body.metallic, body.coatWeight], ['body', hexToLinearRgb(planLook.palette.primary), 0.35, 0.1, 0.6]);
    const cap = subjectMaterial('cap', planLook.palette);
    assert.deepEqual([cap.name, cap.baseColor, cap.roughness, cap.metallic, cap.coatWeight], ['cap', hexToLinearRgb(planLook.palette.highlight), 0.25, 0.8, 0]);
    const surface = surfaceMaterial(planLook.palette);
    assert.deepEqual([surface.name, surface.baseColor, surface.roughness, surface.metallic], ['surface', hexToLinearRgb(planLook.palette.surface), 0.9, 0]);
  });

  it('makes a neutral patch its linear reflectance and a swatch its decoded colour, both perfectly rough; a sphere keeps its roughness', () => {
    assert.deepEqual(calibrationPatchMaterial({ id: 'gray-18', hex: '#767676', linearReflectance: 0.18 }).baseColor, { r: 0.18, g: 0.18, b: 0.18 });
    const red = calibrationPatchMaterial({ id: 'swatch-red', hex: '#cc0000', linearReflectance: null });
    assert.deepEqual([red.name, red.baseColor, red.roughness, red.metallic], ['calibration-swatch-red', hexToLinearRgb('#cc0000'), 1, 0]);
    assert.equal(calibrationSphereMaterial({ id: 'sphere-glossy', hex: '#767676', roughness: 0.15 }).roughness, 0.15);
  });
});
