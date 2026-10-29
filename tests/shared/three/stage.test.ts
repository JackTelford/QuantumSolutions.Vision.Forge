import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calibrationScene } from '../../../src/shared/calibration/scene.ts';
import { calibrationBackdropStyle, calibrationPatchStyle, calibrationPatches } from '../../../src/shared/html/calibration.ts';
import { cycRadiusM, floorSizeM, floorY, fogDensity, fogDensityPerHaze, stageLayout, wallDepthM, wallSizeM } from '../../../src/shared/three/stage.ts';
import { planLook } from '../../plan/fixtures.ts';
import { assertClose } from './fixtures.ts';

const bottle = { w: 0.08, h: 0.25, d: 0.08 };
const epsilon = 1e-9;

describe('stageLayout', () => {
  it('puts the floor under the subject\'s bottom face and the wall 2.5 m behind the anchor', () => {
    const layout = stageLayout(floorY(bottle));
    assert.equal(floorY(bottle), -0.125);
    assert.equal(layout.floorCentre.y, -0.125);
    assert.equal(layout.wallCentre.z, wallDepthM);
  });

  it('joins the floor to the wall with a quarter cylinder: the floor ends where the curve starts and the wall starts where it ends', () => {
    const layout = stageLayout(floorY(bottle));
    const floorFarEdgeZ = layout.floorCentre.z - floorSizeM / 2;
    assertClose(floorFarEdgeZ, layout.cycCentre.z, epsilon, 'floor edge at the curve axis');
    assertClose(layout.cycCentre.y - cycRadiusM, layout.floorCentre.y, epsilon, 'the curve is tangent to the floor');
    assertClose(layout.cycCentre.z - cycRadiusM, wallDepthM, epsilon, 'the curve is tangent to the wall');
    assertClose(layout.wallCentre.y - wallSizeM.heightM / 2, layout.cycCentre.y, epsilon, 'the wall starts at the curve top');
  });
});

describe('fogDensity', () => {
  it('is 0.35 per unit of haze and 0 without haze', () => {
    assert.equal(fogDensity(0), 0);
    assertClose(fogDensity(0.15), 0.15 * fogDensityPerHaze, epsilon, 'haze 0.15');
    assert.equal(fogDensity(-1), 0);
  });
});

describe('html calibration styles', () => {
  it('lists the nine patches and none of the spheres or the text line', () => {
    const patches = calibrationPatches(calibrationScene.elements);
    assert.equal(patches.length, 9);
    assert.ok(patches.every((patch) => patch.kind === 'patch'));
  });

  it('fills the frame with the look\'s background and puts each patch at its box in pixels with its own colour', () => {
    assert.equal(calibrationBackdropStyle(planLook.palette)['background'], planLook.palette.background);
    const gray = calibrationPatches(calibrationScene.elements).find((patch) => patch.id === 'gray-18') ?? assert.fail('gray-18');
    const style = calibrationPatchStyle(gray, 1920, 1080);
    assert.equal(style['left'], '768.000px');
    assert.equal(style['top'], '324.000px');
    assert.equal(style['width'], '384.000px');
    assert.equal(style['height'], '324.000px');
    assert.equal(style['background'], '#767676');
  });
});
