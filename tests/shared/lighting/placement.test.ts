import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distance } from '../../../src/shared/camera/vector.ts';
import { cameraAzimuthDeg, fillElevationDeg, lightDistanceM, lightSizeM, lightWorldPosition, placeRig } from '../../../src/shared/lighting/placement.ts';
import { lightingRigs } from '../../../src/shared/lighting/rigs.ts';
import { makeShot, basePoseFor } from '../camera/fixtures.ts';

const epsilon = 1e-9;

describe('light placement', () => {
  it('reads the camera azimuth from its position: a camera on +Z is at 0, on +X at 90', () => {
    assert.ok(Math.abs(cameraAzimuthDeg({ x: 0, y: 0.2, z: 2 })) < epsilon);
    assert.ok(Math.abs(cameraAzimuthDeg({ x: 2, y: 0, z: 0 }) - 90) < epsilon);
    assert.ok(Math.abs(cameraAzimuthDeg(basePoseFor(makeShot()).position)) < epsilon, 'the eye-level base pose stands on +Z');
  });

  it('puts a light at camera-right on the camera\'s right whatever the camera azimuth', () => {
    const light = { azimuthDeg: 90, elevationDeg: 0 };
    const fromFront = lightWorldPosition(light, 0, 0.25);
    assert.ok(fromFront.x > 0 && Math.abs(fromFront.z) < epsilon, 'camera on +Z: right is +X');
    const fromRight = lightWorldPosition(light, 90, 0.25);
    assert.ok(fromRight.z < 0 && Math.abs(fromRight.x) < epsilon, 'camera on +X: right is -Z');
  });

  it('stands lights on a sphere that grows with the subject but never closer than 1.2 m, sized per metre of subject height', () => {
    assert.equal(lightDistanceM(0.25), 1.2);
    assert.equal(lightDistanceM(1), 3);
    assert.ok(Math.abs(distance({ x: 0, y: 0, z: 0 }, lightWorldPosition({ azimuthDeg: 45, elevationDeg: 35 }, 0, 0.25)) - 1.2) < epsilon);
    assert.ok(Math.abs(lightSizeM({ azimuthDeg: 0, elevationDeg: 0, sizeM: 1.2, kelvin: 5600, intensity: 1, tint: null }, 0.5) - 0.6) < epsilon);
  });

  it('places the product-studio key, a fill opposite it at the fill ratio, and the rim', () => {
    const placed = placeRig(lightingRigs['product-studio'], 0, 0.25);
    assert.ok(placed.key !== null && placed.fill !== null);
    assert.equal(placed.rims.length, 1);
    assert.equal(placed.ambient, 0);
    assert.ok(placed.key.position.x > 0 && placed.key.position.y > 0, 'key at azimuth 45, elevation 35 is up and to the right');
    assert.ok(placed.fill.position.x < 0, 'the fill stands opposite the key');
    assert.ok(Math.abs(placed.fill.intensity - placed.key.intensity / 3) < epsilon, 'fill at 1:3');
    assert.ok(Math.abs(placed.fill.sizeM - placed.key.sizeM * 2) < epsilon);
    assert.ok(placed.fill.position.y > 0, `fill elevation ${fillElevationDeg} is above the anchor`);
  });

  it('turns the key and the fill together with the key orbit and leaves the rims', () => {
    const still = placeRig(lightingRigs['product-studio'], 0, 0.25);
    const turned = placeRig(lightingRigs['product-studio'], 0, 0.25, 90);
    assert.ok(still.key !== null && turned.key !== null && still.fill !== null && turned.fill !== null);
    assert.ok(distance(still.key.position, turned.key.position) > 0.5);
    assert.ok(distance(still.fill.position, turned.fill.position) > 0.5);
    assert.ok(distance(still.rims[0]!.position, turned.rims[0]!.position) < epsilon);
  });

  it('gives a rig without a key no fill and an ambient strength from its fill ratio', () => {
    const placed = placeRig(lightingRigs['rim-only'], 0, 0.25);
    assert.equal(placed.key, null);
    assert.equal(placed.fill, null);
    assert.equal(placed.rims.length, 2);
    assert.ok(placed.ambient > 0);
  });
});
