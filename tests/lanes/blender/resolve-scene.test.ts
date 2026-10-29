import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { placedRigAt } from '../../../src/lanes/blender/lights.ts';
import { resolveScene } from '../../../src/lanes/blender/resolve-scene.ts';
import { sceneFileName, writeSceneDocument } from '../../../src/lanes/blender/scene-file.ts';
import { turntableEmptyName } from '../../../src/lanes/blender/subject.ts';
import { hdriStrengthOf, worldColourStrength } from '../../../src/lanes/blender/world.ts';
import { frameFileName } from '../../../src/render/cache.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import { blenderKeyedHdriStrength } from '../../../src/shared/blender/calibration-scalars.ts';
import { blenderQuaternionFields, toBlenderQuaternion, toBlenderVector } from '../../../src/shared/camera/blender-axes.ts';
import { hexToLinearRgb } from '../../../src/shared/color/srgb.ts';
import { contentHash } from '../../../src/shared/sha256.ts';
import { planLook } from '../../plan/fixtures.ts';
import { mutated } from '../../schema/documents/examples.ts';
import { allFrames, bakeOf, inputsFor, pushInShot, sceneFor, turntableShot } from './resolve-fixtures.ts';

describe('resolveScene', () => {
  it('resolves the push-in and the turntable fixture shots to documents that validate against the blender-scene schema', () => {
    for (const shot of [pushInShot, turntableShot]) {
      const scene = sceneFor(shot);
      validateDocument('blender-scene', scene);
      assert.equal(scene.shotId, shot.id);
    }
  });

  it('resolves the calibration scene and a one-frame still to documents that validate', () => {
    validateDocument('blender-scene', sceneFor(pushInShot, { scene: 'calibration', frames: [0] }));
    validateDocument('blender-scene', sceneFor(pushInShot, { frames: [60], attempt: { engine: 'cycles', device: 'OPTIX', samples: 128 } }));
  });

  it('is a pure function of its inputs: resolving twice gives deep-equal documents', () => {
    assert.deepEqual(resolveScene(inputsFor(turntableShot)), resolveScene(inputsFor(turntableShot)));
  });

  it('starts at frame 0 with the cache\'s f###### stem, so frame k lands at the cache\'s own file name', () => {
    const scene = sceneFor(pushInShot);
    assert.equal(scene.output.frameStart, 0);
    assert.equal(scene.output.frameEnd, pushInShot.durationFrames - 1);
    assert.equal(scene.output.fileStem, 'f######');
    const rendered = scene.output.fileStem.replace(/#+/, (hashes) => String(12).padStart(hashes.length, '0')) + '.png';
    assert.equal(rendered, frameFileName(12));
    assert.deepEqual([scene.output.fps, scene.output.width, scene.output.height, scene.output.colorDepth], [30, 1920, 1080, '8']);
  });

  it('renders a batch of frames from its first to its last, keyframed one frame past each end so the shutter window sees the motion', () => {
    const scene = sceneFor(pushInShot, { frames: [10, 11, 12, 13, 14] });
    assert.equal(scene.output.frameStart, 10);
    assert.equal(scene.output.frameEnd, 14);
    assert.deepEqual(scene.camera.keyframes.map((keyframe) => keyframe.frame), [9, 10, 11, 12, 13, 14, 15]);
  });

  it('keyframes a still at frame 60 at 59, 60 and 61 on the camera, the turntable and the key, so the still blurs like the three lane\'s', () => {
    const scene = sceneFor(turntableShot, { frames: [60] });
    assert.deepEqual([scene.output.frameStart, scene.output.frameEnd], [60, 60]);
    assert.deepEqual(scene.camera.keyframes.map((keyframe) => keyframe.frame), [59, 60, 61]);
    assert.deepEqual(scene.empties[0]?.rotationZKeyframes.map((keyframe) => keyframe.frame), [59, 60, 61]);
    assert.deepEqual(scene.lights[0]?.locationKeyframes.map((keyframe) => keyframe.frame), [59, 60, 61]);
  });

  it('keyframes the first batch from 0 and the last batch up to the shot\'s last frame, never past the bake', () => {
    const last = pushInShot.durationFrames - 1;
    const firstBatch = sceneFor(pushInShot, { frames: [0, 1, 2] });
    assert.deepEqual(firstBatch.camera.keyframes.map((keyframe) => keyframe.frame), [0, 1, 2, 3]);
    const lastBatch = sceneFor(pushInShot, { frames: [last - 2, last - 1, last] });
    assert.deepEqual(lastBatch.camera.keyframes.map((keyframe) => keyframe.frame), [last - 3, last - 2, last - 1, last]);
    assert.deepEqual(lastBatch.empties[0]?.rotationZKeyframes.map((keyframe) => keyframe.frame), [last - 3, last - 2, last - 1, last]);
    assert.deepEqual(lastBatch.lights[0]?.locationKeyframes.map((keyframe) => keyframe.frame), [last - 3, last - 2, last - 1, last]);
  });

  it('writes the frames directory and the HDRI path with forward slashes', () => {
    const scene = sceneFor(pushInShot, { framesDirectory: 'C:\\vf\\cache\\abc\\frames', hdriPath: 'C:\\vf\\assets\\hdri\\studio_small_09_1k.hdr' });
    assert.equal(scene.output.directory, 'C:/vf/cache/abc/frames');
    assert.equal(scene.world.hdriPath, 'C:/vf/assets/hdri/studio_small_09_1k.hdr');
  });

  it('refuses frames that are not contiguous, empty, or outside the bake', () => {
    assert.throws(() => sceneFor(pushInShot, { frames: [0, 2] }), /contiguous/);
    assert.throws(() => sceneFor(pushInShot, { frames: [] }), /at least one frame/);
    assert.throws(() => sceneFor(pushInShot, { frames: [pushInShot.durationFrames] }), /no entry for frame/);
  });
});

describe('the camera section', () => {
  it('puts keyframe 0 at the bake\'s first position and orientation mapped through the Blender axes, with the lens, f-stop and focus of the frame', () => {
    const bake = bakeOf(pushInShot);
    const first = bake[0];
    assert.ok(first !== undefined);
    const keyframe = sceneFor(pushInShot).camera.keyframes[0];
    assert.ok(keyframe !== undefined);
    assert.deepEqual(keyframe.location, toBlenderVector(first.position));
    assert.deepEqual(keyframe.rotationQuaternion, blenderQuaternionFields(toBlenderQuaternion(first.rotation)));
    assert.deepEqual([keyframe.lensMm, keyframe.fStop, keyframe.focusDistanceM], [first.focalMm, first.fStop, first.focusDistanceM]);
  });

  it('has as many keyframes as frames, on a 36 mm sensor with depth of field on and the clip planes of the three lane', () => {
    const scene = sceneFor(pushInShot);
    assert.equal(scene.camera.keyframes.length, pushInShot.durationFrames);
    assert.deepEqual([scene.camera.sensorWidthMm, scene.camera.useDof, scene.camera.clipStartM, scene.camera.clipEndM], [36, true, 0.02, 100]);
  });
});

describe('the subject', () => {
  it('parents the bottle\'s three cylinders to the turntable empty at the anchor, in the body and cap materials', () => {
    const scene = sceneFor(pushInShot);
    const parts = scene.objects.filter((object) => object.parent === turntableEmptyName);
    assert.deepEqual(parts.map((part) => [part.name, part.kind, part.material]), [['body', 'cylinder', 'body'], ['neck', 'cylinder', 'body'], ['cap', 'cylinder', 'cap']]);
    assert.ok(parts.every((part) => part.vertices === 64 && part.radiusM > 0 && part.depthM > 0));
    const empty = scene.empties[0];
    assert.ok(empty !== undefined && empty.name === turntableEmptyName);
    assert.deepEqual(empty.location, { x: 0, y: 0, z: 0 });
    assert.ok(scene.materials.some((material) => material.name === 'body' && material.coatWeight === 0.6 && material.roughness === 0.35 && material.metallic === 0.1));
    assert.ok(scene.materials.some((material) => material.name === 'cap' && material.roughness === 0.25 && material.metallic === 0.8));
    assert.ok(scene.materials.some((material) => material.name === 'surface' && material.roughness === 0.9 && material.metallic === 0));
  });

  it('keyframes the turntable empty once per frame with monotonically growing radians for the turntable move', () => {
    const scene = sceneFor(turntableShot);
    const empty = scene.empties[0];
    assert.ok(empty !== undefined);
    assert.equal(empty.rotationZKeyframes.length, turntableShot.durationFrames);
    const radians = empty.rotationZKeyframes.map((keyframe) => keyframe.radians);
    for (let index = 1; index < radians.length; index += 1) {
      const previous = radians[index - 1];
      const current = radians[index];
      assert.ok(previous !== undefined && current !== undefined && current >= previous, `frame ${String(index)} turns back: ${String(previous)} to ${String(current)}`);
    }
    const last = radians[radians.length - 1];
    assert.ok(last !== undefined && last > 0, 'the turntable turns');
  });

  it('scales a unit cube to a box subject\'s size with the height on Blender\'s Z and turns a torus a quarter about X', () => {
    const boxShot = mutated(pushInShot, (copy) => {
      copy.subject.primitive = 'box';
      copy.subject.boundsM = { w: 0.3, h: 0.1, d: 0.2 };
    });
    const cube = sceneFor(boxShot).objects.find((object) => object.kind === 'cube');
    assert.ok(cube !== undefined);
    assert.deepEqual(cube.scale, { x: 0.3, y: 0.2, z: 0.1 });
    assert.equal(cube.sizeM, 1);
    assert.equal(cube.shadeSmooth, false);
    const torusShot = mutated(pushInShot, (copy) => { copy.subject.primitive = 'torus'; });
    const torus = sceneFor(torusShot).objects.find((object) => object.kind === 'torus');
    assert.ok(torus !== undefined);
    assert.deepEqual(torus.rotationEulerRad, { x: Math.PI / 2, y: 0, z: 0 });
    assert.ok(torus.majorRadiusM > torus.minorRadiusM && torus.minorRadiusM > 0);
  });

  it('builds a pill as a cylinder between two spheres at the tube\'s ends', () => {
    const pillShot = mutated(pushInShot, (copy) => { copy.subject.primitive = 'pill'; });
    const objects = sceneFor(pillShot).objects.filter((object) => object.parent === turntableEmptyName);
    assert.deepEqual(objects.map((object) => object.kind), ['cylinder', 'uv-sphere', 'uv-sphere']);
    const [tube, top, bottom] = objects;
    assert.ok(tube !== undefined && top !== undefined && bottom !== undefined);
    assert.ok(Math.abs(top.location.z - tube.depthM / 2) < 1e-12 && Math.abs(bottom.location.z + tube.depthM / 2) < 1e-12);
  });
});

describe('the render section', () => {
  it('writes the attempt\'s engine and samples: EEVEE at 64 for a clip, Cycles OptiX at 256 with denoising for a 4K still', () => {
    const clip = sceneFor(pushInShot);
    assert.equal(clip.render.engine, 'BLENDER_EEVEE');
    assert.equal(clip.render.eeveeSamples, 64);
    assert.equal(clip.render.cycles.useDenoising, false);
    assert.deepEqual([clip.render.cycles.device, clip.render.cycles.computeDeviceType, clip.render.cycles.deviceTypes], ['CPU', 'NONE', ['CPU']]);
    const still = sceneFor(pushInShot, { frames: [0], still: true, attempt: { engine: 'cycles', device: 'OPTIX', samples: 256 }, spec: { fps: 30, width: 3840, height: 2160 } });
    assert.equal(still.render.engine, 'CYCLES');
    assert.equal(still.render.cycles.samples, 256);
    assert.equal(still.render.cycles.useDenoising, true);
    assert.deepEqual([still.render.cycles.denoiser, still.render.cycles.device, still.render.cycles.computeDeviceType, still.render.cycles.deviceTypes], ['OPTIX', 'GPU', 'OPTIX', ['OPTIX']]);
    const cuda = sceneFor(pushInShot, { attempt: { engine: 'cycles', device: 'CUDA', samples: 128 } });
    assert.deepEqual([cuda.render.cycles.denoiser, cuda.render.cycles.computeDeviceType], ['OPENIMAGEDENOISE', 'CUDA']);
  });

  it('turns motion blur on with the 180-degree shutter as 0.5 frames and maps the look\'s tone mapping and exposure', () => {
    const scene = sceneFor(pushInShot);
    assert.deepEqual(scene.render.motionBlur, { enabled: true, shutter: 0.5 });
    assert.equal(scene.colorManagement.viewTransform, 'AgX');
    assert.equal(scene.colorManagement.exposure, planLook.exposureEv + pushInShot.exposureOffsetEv);
    const standard = sceneFor(pushInShot, { look: { ...planLook, toneMapping: 'standard' } });
    assert.equal(standard.colorManagement.viewTransform, 'Standard');
  });
});

describe('the world', () => {
  it('is the look\'s background colour in linear light at a fifth of its strength without an HDRI, and the HDRI at the keyed ambient strength turned toward the key with one', () => {
    const flat = sceneFor(pushInShot).world;
    assert.deepEqual(flat.color, hexToLinearRgb(planLook.palette.background));
    assert.equal(flat.strength, worldColourStrength);
    assert.equal(flat.hdriPath, null);
    assert.equal(flat.hdriRotationZRad, 0);
    const lit = sceneFor(pushInShot, { hdriPath: 'C:/vf/assets/hdri/studio_small_09_1k.hdr' }).world;
    assert.equal(lit.hdriPath, 'C:/vf/assets/hdri/studio_small_09_1k.hdr');
    assert.equal(lit.hdriStrength, blenderKeyedHdriStrength);
    assert.equal(lit.hdriStrength, 0.05);
    assert.ok(lit.hdriRotationZRad !== 0 && Number.isFinite(lit.hdriRotationZRad));
  });

  it('plays the HDRI at one over the fill ratio for a rig without a key, where the HDRI is the fill', () => {
    // The fixture shot's lighting overrides set the fill ratio to 4, so a keyless rig's ambient is 1/4 whatever the preset's own ratio.
    for (const preset of ['rim-only', 'contre-jour'] as const) {
      const keyless = mutated(pushInShot, (copy) => { copy.lighting.preset = preset; });
      const bake = bakeOf(keyless);
      const placed = placedRigAt(keyless, bake, bake[0] ?? assert.fail('the bake is empty'));
      assert.ok(placed.key === null, `${preset} has no key`);
      assert.equal(placed.ambient, 1 / keyless.lighting.fillRatio);
      assert.equal(sceneFor(keyless, { hdriPath: 'C:/vf/assets/hdri/x.hdr' }).world.hdriStrength, placed.ambient);
    }
    assert.equal(hdriStrengthOf({ key: null, fill: null, rims: [], ambient: 0.25 }), 0.25);
    assert.equal(hdriStrengthOf({ key: null, fill: null, rims: [], ambient: 1 }), 1);
  });
});

describe('the calibration scene', () => {
  it('replaces the subject and the stage with nine patch quads and two spheres in their own materials, the gray card at linear 0.18', () => {
    const scene = sceneFor(pushInShot, { scene: 'calibration', frames: allFrames(pushInShot).slice(0, 1) });
    assert.equal(scene.empties.length, 0);
    assert.equal(scene.objects.filter((object) => object.kind === 'mesh').length, 9);
    assert.equal(scene.objects.filter((object) => object.kind === 'uv-sphere').length, 2);
    assert.ok(scene.objects.every((object) => object.parent === null));
    const gray = scene.materials.find((material) => material.name === 'calibration-gray-18');
    assert.ok(gray !== undefined);
    assert.deepEqual([gray.baseColor, gray.roughness, gray.metallic, gray.emissionStrength], [{ r: 0.18, g: 0.18, b: 0.18 }, 1, 0, 0]);
    const patch = scene.objects.find((object) => object.name === 'gray-18');
    assert.ok(patch !== undefined);
    assert.equal(patch.meshVertices.length, 4);
    assert.deepEqual(patch.meshFaces, [[0, 1, 2, 3]]);
  });
});

describe('writeSceneDocument', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-blender-scene-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes scene.json under the directory and returns its content hash', async () => {
    const scene = sceneFor(pushInShot, { frames: [0] });
    const written = await writeSceneDocument(join(dir, 'cache'), scene);
    assert.equal(written.path, join(dir, 'cache', sceneFileName));
    assert.deepEqual(JSON.parse(readFileSync(written.path, 'utf8')), scene);
    assert.equal(written.hash, await contentHash(scene));
    assert.match(written.hash, /^[0-9a-f]{64}$/);
  });

  it('refuses a document that does not validate before writing anything', async () => {
    const scene = sceneFor(pushInShot, { frames: [0] });
    const broken = { ...scene, render: { ...scene.render, engine: 'WORKBENCH' } };
    await assert.rejects(writeSceneDocument(join(dir, 'broken'), broken as never), /blender-scene/);
  });
});
