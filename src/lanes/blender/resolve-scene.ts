/**
 * The resolver of the blender lane: a shot, its look, the baked camera,
 * the frames to render, the attempt the ladder chose and the installed
 * HDRI become one closed blender-scene document (schemas/blender-scene,
 * ADR 0004 decision 5) with every value written, so blender/apply_scene.py
 * makes bpy calls and takes no decision. A pure function of its inputs:
 * no clock, no randomness, no file system; the same inputs always give
 * the same document, which the scene hash in the render manifest relies
 * on. Writing the document is scene-file.ts.
 */
import type { CameraFrame, RenderSpec } from '../../shared/camera/types.ts';
import type { BlenderScene, Material, SceneObject } from '../../shared/contracts/blender-scene.ts';
import type { LookBible } from '../../shared/contracts/look-bible.ts';
import type { Shot } from '../../shared/contracts/shot-spec.ts';
import { calibrationMaterials, calibrationObjects } from './calibration.ts';
import { bakedFrame, blenderCamera } from './camera.ts';
import { cycObject } from './cyc-mesh.ts';
import { areaLights, placedRigAt } from './lights.ts';
import { subjectMaterials, surfaceMaterial } from './materials.ts';
import { colorManagement, outputSettings, renderSettings } from './render-settings.ts';
import type { BlenderAttempt } from './render-settings.ts';
import { subjectObjects, turntableEmpty } from './subject.ts';
import { blenderWorld } from './world.ts';

/** The frame-file prefix of the render cache: frames are named f000000.png and so on (src/render/cache.ts). */
export const cacheOutputStem = 'f';

/** Everything the resolver needs for one render of a shot. */
export interface ResolveSceneInputs {
  readonly shot: Shot;
  readonly look: LookBible;
  /** The frame rate and size of the shot spec. */
  readonly spec: RenderSpec;
  /** The whole bake of the shot, one entry per frame, index = frame (camera/bake.ts). */
  readonly camera: readonly CameraFrame[];
  /** The shot frames to render in this process, contiguous and ascending, every one inside the bake. */
  readonly frames: readonly number[];
  /** The rung of the attempt ladder: engine, device and samples. */
  readonly attempt: BlenderAttempt;
  /** The absolute path of the rig's HDRI under the data directory, or null for a flat world. Written with forward slashes. */
  readonly hdriPath: string | null;
  /** The absolute directory the frames are written to: the shot cache's frames folder. */
  readonly framesDirectory: string;
  /** The frame-file prefix, cacheOutputStem for the render cache. */
  readonly outputStem: string;
  /** True for a still (denoised, the still samples); false for every batch of a clip, however short, so a frame's pixels never depend on where the batches were cut. */
  readonly still: boolean;
  /** When "calibration", the patches and spheres of ADR 0008 replace the subject and the stage, lit by the shot's rig. */
  readonly scene?: 'calibration';
}

/** Checks that the frames are a non-empty ascending run of integers the bake holds; anything else is a programming error named in the message. */
export function assertContiguousFrames(frames: readonly number[], camera: readonly CameraFrame[]): void {
  const first = frames[0];
  if (first === undefined) throw new RangeError('A Blender scene renders at least one frame.');
  frames.forEach((frame, index) => {
    if (!Number.isInteger(frame) || frame !== first + index) throw new RangeError(`The frames to render must be contiguous and ascending; ${JSON.stringify(frames)} is not.`);
    bakedFrame(camera, frame);
  });
}

/**
 * The closed scene document for one render. A product shot carries the
 * subject's parts under the turntable empty, the stage mesh and the three
 * palette materials; the calibration scene carries the patches and
 * spheres in their own materials and no stage, its background the look's
 * background colour unless an HDRI is given. The lights, camera, render
 * settings and world are the same for both. A still renders with
 * denoising; a clip does not, whatever the length of its batches.
 */
export function resolveScene(inputs: ResolveSceneInputs): BlenderScene {
  assertContiguousFrames(inputs.frames, inputs.camera);
  const { shot, look, spec, camera, frames } = inputs;
  const first = bakedFrame(camera, frames[0] ?? 0);
  const still = inputs.still;
  const calibration = inputs.scene === 'calibration';
  const materials: Material[] = calibration ? [...calibrationMaterials(), surfaceMaterial(look.palette)] : [...subjectMaterials(look.palette)];
  const objects: SceneObject[] = calibration ? [...calibrationObjects(first, spec.width / spec.height)] : [...subjectObjects(shot), cycObject(shot.subject.boundsM)];
  return {
    kind: 'blender-scene',
    version: 1,
    shotId: shot.id,
    output: outputSettings(inputs.framesDirectory, inputs.outputStem, frames, spec),
    render: renderSettings(inputs.attempt, still, spec.width, bakedFrame(camera, 0)),
    colorManagement: colorManagement(look, shot),
    world: blenderWorld(look.palette, inputs.hdriPath, placedRigAt(shot, camera, first)),
    camera: blenderCamera(camera, frames),
    materials,
    empties: calibration ? [] : [turntableEmpty(camera, frames)],
    objects,
    lights: [...areaLights(shot, camera, frames, look.toneMapping)],
  };
}
