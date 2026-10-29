import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lightingRigs } from '../../../src/shared/lighting/rigs.ts';
import { placeRig } from '../../../src/shared/lighting/placement.ts';
import { hexToRgb, kelvinToRgb } from '../../../src/shared/look/css-tokens.ts';
import { keyIntensityScalar, keyedEnvironmentIntensity, shadowKeyShare } from '../../../src/shared/three/calibration-scalars.ts';
import { toneMappingExposure } from '../../../src/shared/three/exposure.ts';
import { environmentIntensityOf, placedLightRgb, placedRigWhiteBalanceKelvin, rectAreaIntensity, shadowBoxHalfM, shadowCameraRange, shadowLightSettings } from '../../../src/shared/three/lights.ts';
import { calibrationPatchMaterial, calibrationSphereMaterial, stageMaterial, subjectMaterial } from '../../../src/shared/three/materials.ts';
import { planLook } from '../../plan/fixtures.ts';
import { assertClose } from './fixtures.ts';

const studio = placeRig(lightingRigs['product-studio'], 0, 0.25);
const rimOnly = placeRig(lightingRigs['rim-only'], 0, 0.25);
const neon = placeRig(lightingRigs['neon-night'], 0, 0.25);

describe('placedLightRgb', () => {
  it('renders the key neutral under the rig\'s own white balance, a 3200 K light warm and an 8000 K light blue', () => {
    assert.ok(studio.key !== null);
    assert.equal(placedRigWhiteBalanceKelvin(studio), 5600);
    assert.deepEqual(placedLightRgb(studio.key, placedRigWhiteBalanceKelvin(studio)), { r: 255, g: 255, b: 255 });
    const warm = placedLightRgb({ tint: null, kelvin: 3200 }, 5600);
    assert.ok(warm.r === 255 && warm.g < 230 && warm.b < 150, `a 3200 K light under a 5600 K balance is warm: ${JSON.stringify(warm)}`);
    const cool = placedLightRgb({ tint: null, kelvin: 8000 }, 5600);
    assert.ok(cool.b === 255 && cool.r < cool.b, `an 8000 K light under a 5600 K balance is blue: ${JSON.stringify(cool)}`);
    assert.deepEqual(placedLightRgb({ tint: null, kelvin: 6600 }, 6600), kelvinToRgb(6600));
  });

  it('uses the tint instead of the temperature for a neon light', () => {
    assert.ok(neon.key !== null && neon.key.tint !== null);
    assert.deepEqual(placedLightRgb(neon.key, placedRigWhiteBalanceKelvin(neon)), hexToRgb(neon.key.tint));
  });
});

describe('rectAreaIntensity', () => {
  it('turns the relative intensity into a panel radiance of scalar × d² / area, so the key at 1.2 m with a 0.3 m panel is 16 times the scalar', () => {
    assert.ok(studio.key !== null && studio.fill !== null);
    assertClose(rectAreaIntensity(studio.key, 'agx'), keyIntensityScalar.agx * 16, 1e-9, 'key');
    assertClose(rectAreaIntensity(studio.key, 'standard'), keyIntensityScalar.standard * 16, 1e-9, 'key under standard');
  });

  it('gives the fill, twice the key\'s size at a third of its intensity, a third of the key\'s irradiance: radiance × area is a third of the key\'s', () => {
    assert.ok(studio.key !== null && studio.fill !== null);
    const keyPower = rectAreaIntensity(studio.key, 'agx') * studio.key.sizeM ** 2;
    const fillPower = rectAreaIntensity(studio.fill, 'agx') * studio.fill.sizeM ** 2;
    assertClose(fillPower / keyPower, 1 / 3, 1e-9, 'fill to key');
  });

  it('keeps the irradiance of a rig the same for a small subject and a large one, although the light distance clamps at 1.2 m', () => {
    const small = placeRig(lightingRigs['product-studio'], 0, 0.1);
    const large = placeRig(lightingRigs['product-studio'], 0, 1);
    assert.ok(small.key !== null && large.key !== null);
    const irradiance = (key: { readonly sizeM: number; readonly position: { x: number; y: number; z: number } }, radiance: number): number => (radiance * key.sizeM ** 2) / (key.position.x ** 2 + key.position.y ** 2 + key.position.z ** 2);
    assertClose(irradiance(small.key, rectAreaIntensity(small.key, 'agx')), irradiance(large.key, rectAreaIntensity(large.key, 'agx')), 1e-9, 'irradiance');
  });
});

describe('shadowLightSettings', () => {
  it('aligns the shadow light with the key at its share of the key\'s intensity under agx, and omits it for a rig without a key', () => {
    const shadow = shadowLightSettings(studio, 'agx');
    assert.ok(shadow !== null && studio.key !== null);
    assert.deepEqual(shadow.position, studio.key.position);
    assert.deepEqual(shadow.target, studio.key.target);
    assertClose(shadow.intensity, shadowKeyShare, 1e-9, 'intensity');
    assert.equal(shadowLightSettings(rimOnly, 'agx'), null);
  });

  it('scales the share by the tone mapping\'s key scalar, so the shadow light is the same fraction of the key under standard as under agx', () => {
    const agx = shadowLightSettings(studio, 'agx');
    const standard = shadowLightSettings(studio, 'standard');
    assert.ok(agx !== null && standard !== null && studio.key !== null);
    assertClose(standard.intensity / rectAreaIntensity(studio.key, 'standard'), agx.intensity / rectAreaIntensity(studio.key, 'agx'), 1e-12, 'share of the key');
    assertClose(standard.intensity, (shadowKeyShare * keyIntensityScalar.standard) / keyIntensityScalar.agx, 1e-12, 'standard intensity');
  });

  it('wraps the shadow camera around a 1.5 m box at the anchor for a light 1.2 m away over the bottle, and a 2 m half box for a 2 m subject', () => {
    const range = shadowCameraRange(1.2, 0.25);
    assert.ok(range.near > 0 && range.near < 1.2 - shadowBoxHalfM(0.25));
    assert.ok(range.far > 1.2 + shadowBoxHalfM(0.25));
    assert.equal(shadowBoxHalfM(0.25) * 2, 1.5);
    assert.equal(shadowBoxHalfM(2), 2);
    assert.ok(shadowCameraRange(6, 2).far >= 6 + 2 * 2, 'the far plane grows with the box');
  });
});

describe('environmentIntensityOf', () => {
  it('is the small keyed value with a key and the rig\'s ambient without one', () => {
    assert.equal(environmentIntensityOf(studio), keyedEnvironmentIntensity);
    assert.equal(environmentIntensityOf(rimOnly), rimOnly.ambient);
    assert.equal(environmentIntensityOf(placeRig(lightingRigs['contre-jour'], 0, 0.25)), 1 / 6);
  });
});

describe('toneMappingExposure', () => {
  it('is 1 at the calibrated 0 EV and doubles per stop of the look plus the frame, without adding the shot offset twice', () => {
    assert.equal(toneMappingExposure({ exposureEv: 0 }, { exposureEv: 0 }), 1);
    assertClose(toneMappingExposure(planLook, { exposureEv: 1 }), 2 ** (planLook.exposureEv + 1), 1e-12, 'look -0.3 plus one stop');
    assertClose(toneMappingExposure({ exposureEv: 0 }, { exposureEv: -1 }), 0.5, 1e-12, 'one stop down');
  });
});

describe('materials', () => {
  it('builds the body from the primary colour under a clear coat and the cap from the highlight, mostly metal', () => {
    const body = subjectMaterial('body', planLook.palette);
    assert.equal(body.color, planLook.palette.primary);
    assert.deepEqual([body.roughness, body.metalness, body.clearcoat, body.clearcoatRoughness], [0.35, 0.1, 0.6, 0.2]);
    const cap = subjectMaterial('cap', planLook.palette);
    assert.equal(cap.color, planLook.palette.highlight);
    assert.deepEqual([cap.roughness, cap.metalness], [0.25, 0.8]);
  });

  it('makes the stage the surface colour and rough, the patches perfectly rough in their own colour, the spheres at their roughness', () => {
    assert.deepEqual(stageMaterial(planLook.palette), { color: planLook.palette.surface, roughness: 0.9, metalness: 0 });
    assert.deepEqual(calibrationPatchMaterial('#767676'), { color: '#767676', roughness: 1, metalness: 0 });
    assert.equal(calibrationSphereMaterial({ hex: '#767676', roughness: 0.15 }).roughness, 0.15);
  });
});
