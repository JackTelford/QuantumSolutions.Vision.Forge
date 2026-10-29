import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { areaLightAim, areaLightColour, areaLightPowerW, areaLights, clampedTemperatureK } from '../../../src/lanes/blender/lights.ts';
import { hdriRotationZRad } from '../../../src/lanes/blender/world.ts';
import { blenderCalibrationDistanceM, blenderKeyPowerW } from '../../../src/shared/blender/calibration-scalars.ts';
import { toBlenderVector } from '../../../src/shared/camera/blender-axes.ts';
import { rotateVector } from '../../../src/shared/camera/quaternion.ts';
import type { Vector3 } from '../../../src/shared/camera/types.ts';
import { normalize, subtract } from '../../../src/shared/camera/vector.ts';
import { placeRig } from '../../../src/shared/lighting/placement.ts';
import { lightingRigs } from '../../../src/shared/lighting/rigs.ts';
import { mutated } from '../../schema/documents/examples.ts';
import { assertClose } from '../../shared/three/fixtures.ts';
import { allFrames, bakeOf, pushInShot, sceneFor } from './resolve-fixtures.ts';

const studio = placeRig(lightingRigs['product-studio'], 0, 0.25);
const studioLarge = placeRig(lightingRigs['product-studio'], 0, 1);

function assertVector(actual: Vector3, expected: Vector3, label: string): void {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9 && Math.abs(actual.y - expected.y) < 1e-9 && Math.abs(actual.z - expected.z) < 1e-9, `${label}: ${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`);
}

describe('areaLightPowerW', () => {
  it('gives the key at the calibration distance of 1.2 m exactly the key power, and scales with the square of the distance', () => {
    assert.ok(studio.key !== null && studioLarge.key !== null);
    assertClose(areaLightPowerW(studio.key, 'agx'), blenderKeyPowerW.agx, 1e-9, 'key at 1.2 m');
    const ratio = 3 / blenderCalibrationDistanceM;
    assertClose(areaLightPowerW(studioLarge.key, 'agx'), blenderKeyPowerW.agx * ratio * ratio, 1e-9, 'key at 3 m');
    assertClose(areaLightPowerW(studioLarge.key, 'standard'), blenderKeyPowerW.standard * ratio * ratio, 1e-9, 'key at 3 m under standard');
  });

  it('gives the fill a third of the key\'s power under the fixture rig, as the fill ratio says', () => {
    assert.ok(studio.key !== null && studio.fill !== null);
    assertClose(areaLightPowerW(studio.fill, 'agx') / areaLightPowerW(studio.key, 'agx'), 1 / 3, 1e-9, 'fill to key');
  });
});

describe('areaLightColour', () => {
  it('renders the key neutral (1, 1, 1) under its own white balance and a 3200 K fill under a 4800 K key warm', () => {
    assert.deepEqual(areaLightColour({ tint: null, kelvin: 5600 }, 5600), { r: 1, g: 1, b: 1 });
    const warm = areaLightColour({ tint: null, kelvin: 3200 }, 4800);
    assert.equal(warm.r, 1);
    assert.ok(warm.g < 1 && warm.b < warm.g, `a 3200 K fill under a 4800 K key is warm: ${JSON.stringify(warm)}`);
  });

  it('uses the tint of a neon light, decoded to linear light', () => {
    const magenta = areaLightColour({ tint: '#ff2bd6', kelvin: 2200 }, 2200);
    assert.equal(magenta.r, 1);
    assert.ok(magenta.g < 0.03 && magenta.b > 0.6, JSON.stringify(magenta));
  });
});

describe('areaLightAim', () => {
  it('points each light\'s local -Z at the anchor in Blender\'s axes', () => {
    for (const light of [studio.key, studio.fill, ...studio.rims]) {
      assert.ok(light !== null);
      const forward = rotateVector(areaLightAim(light), { x: 0, y: 0, z: -1 });
      assertVector(forward, normalize(subtract(toBlenderVector(light.target), toBlenderVector(light.position))), light.name);
    }
  });
});

describe('areaLights', () => {
  it('writes one square light per placed light, the key first in white with use_temperature off and its kelvin as a record', () => {
    const lights = sceneFor(pushInShot).lights;
    assert.deepEqual(lights.map((light) => light.name), ['key', 'fill', 'rim-1']);
    const key = lights[0];
    assert.ok(key !== undefined);
    assert.deepEqual([key.shape, key.useTemperature, key.temperatureK, key.color], ['SQUARE', false, 5600, { r: 1, g: 1, b: 1 }]);
    assert.equal(key.sizeM, key.sizeYM);
    assertClose(key.powerW, blenderKeyPowerW.agx, 1e-9, 'the key at 1.2 m');
  });

  it('keyframes the key and the fill once per frame and leaves the rims static', () => {
    const scene = sceneFor(pushInShot);
    const [key, fill, rim] = scene.lights;
    assert.ok(key !== undefined && fill !== undefined && rim !== undefined);
    assert.equal(key.locationKeyframes.length, pushInShot.durationFrames);
    assert.equal(fill.locationKeyframes.length, pushInShot.durationFrames);
    assert.equal(rim.locationKeyframes.length, 0);
    assert.deepEqual(key.locationKeyframes[0]?.location, key.location);
  });

  it('moves the key around the subject through the light-sweep move while the rim stays', () => {
    const sweep = mutated(pushInShot, (copy) => { copy.move = { preset: 'light-sweep', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: null }; });
    const scene = sceneFor(sweep);
    const [key, , rim] = scene.lights;
    assert.ok(key !== undefined && rim !== undefined);
    const first = key.locationKeyframes[0];
    const last = key.locationKeyframes[key.locationKeyframes.length - 1];
    assert.ok(first !== undefined && last !== undefined);
    assert.notDeepEqual(first.location, last.location);
    assert.equal(rim.locationKeyframes.length, 0);
    const bakeLast = bakeOf(sweep)[sweep.durationFrames - 1];
    assert.ok(bakeLast !== undefined && bakeLast.keyLightOrbitDeg !== 0, 'the light-sweep bake orbits the key');
  });

  it('clamps the recorded kelvin to Blender\'s range and only lists the lights the rig places', () => {
    assert.equal(clampedTemperatureK(20000), 12000);
    assert.equal(clampedTemperatureK(500), 800);
    assert.equal(clampedTemperatureK(5600), 5600);
    const rimOnly = mutated(pushInShot, (copy) => { copy.lighting.preset = 'rim-only'; });
    assert.deepEqual(sceneFor(rimOnly).lights.map((light) => light.name), ['rim-1', 'rim-2']);
    assert.ok(sceneFor(rimOnly).lights.every((light) => light.locationKeyframes.length === 0));
  });

  it('resolves the lights with the same frames the camera has when only a batch is rendered, one past each end for the blur', () => {
    const frames = allFrames(pushInShot).slice(20, 30);
    const scene = sceneFor(pushInShot, { frames });
    const key = scene.lights[0];
    assert.ok(key !== undefined);
    assert.deepEqual(key.locationKeyframes.map((keyframe) => keyframe.frame), [19, ...frames, 30]);
    assert.deepEqual(scene.camera.keyframes.map((keyframe) => keyframe.frame), key.locationKeyframes.map((keyframe) => keyframe.frame));
  });
});

describe('hdriRotationZRad', () => {
  it('turns the HDRI\'s centre column (read along +X unrotated) toward the key, and leaves a keyless rig unrotated', () => {
    assert.ok(studio.key !== null);
    const key = toBlenderVector(studio.key.position);
    const theta = hdriRotationZRad(studio);
    // The lookup direction of the key, turned by theta about Z, lands on +X: the column at u = 0.5.
    const turned = { x: key.x * Math.cos(theta) - key.y * Math.sin(theta), y: key.x * Math.sin(theta) + key.y * Math.cos(theta) };
    assert.ok(turned.x > 0 && Math.abs(turned.y) < 1e-9, `the key turned by theta is on +X: ${JSON.stringify(turned)}`);
    assert.equal(hdriRotationZRad(placeRig(lightingRigs['rim-only'], 0, 0.25)), 0);
  });
});
