/**
 * Shared inputs for the blender lane tests: the plan fixture's two
 * three shots (s01 push-in, s02 turntable on the bottle, 85 mm f/2.8,
 * product-studio) copied as blender shots, their bakes, and a resolver
 * input set with every field filled. Not a test file: the runner never
 * loads it on its own.
 */
import { bake } from '../../../src/shared/camera/bake.ts';
import type { CameraFrame, RenderSpec } from '../../../src/shared/camera/types.ts';
import { solveBasePose } from '../../../src/shared/composition/solver.ts';
import type { Shot, ShotSpec } from '../../../src/shared/contracts/shot-spec.ts';
import { resolveScene } from '../../../src/lanes/blender/resolve-scene.ts';
import type { ResolveSceneInputs } from '../../../src/lanes/blender/resolve-scene.ts';
import type { BlenderScene } from '../../../src/shared/contracts/blender-scene.ts';
import { planLook, planShotSpec } from '../../plan/fixtures.ts';
import { mutated } from '../../schema/documents/examples.ts';

/** The plan fixture with every shot moved to the blender lane and its render profile cleared, as a shot arrives at the still gate. */
export const blenderShotSpec: ShotSpec = mutated(planShotSpec, (copy) => {
  for (const shot of copy.shots) {
    shot.lane = 'blender';
    shot.renderProfile = null;
  }
});

/** The frame rate and size of the fixture. */
export const fixtureSpec: RenderSpec = { fps: blenderShotSpec.fps, width: blenderShotSpec.width, height: blenderShotSpec.height };

/** The blender shot at an index of the fixture. */
export function blenderShotAt(index: number): Shot {
  const shot = blenderShotSpec.shots[index];
  if (shot === undefined) throw new Error(`the fixture has no shot at index ${String(index)}`);
  return shot;
}

/** s01: the 85 mm f/2.8 push-in on the bottle under product-studio, 105 frames. */
export const pushInShot: Shot = blenderShotAt(0);

/** s02: the turntable on the same bottle, 90 frames. */
export const turntableShot: Shot = blenderShotAt(1);

/** The whole bake of a shot at the fixture's size. */
export function bakeOf(shot: Shot): readonly CameraFrame[] {
  return bake(shot, fixtureSpec, solveBasePose(shot, fixtureSpec));
}

/** Every frame number of a shot, 0 to durationFrames − 1. */
export function allFrames(shot: Shot): readonly number[] {
  return Array.from({ length: shot.durationFrames }, (_, frame) => frame);
}

/** The frames directory every fixture scene writes to, as the cache would name it. */
export const fixtureFramesDirectory = 'C:/vf/cache/0123456789ab/frames';

/** Resolver inputs for a shot: every frame, an EEVEE attempt at 64 samples, no HDRI, the obsidian look; overrides replace fields. */
export function inputsFor(shot: Shot, overrides: Partial<ResolveSceneInputs> = {}): ResolveSceneInputs {
  return {
    shot,
    look: planLook,
    spec: fixtureSpec,
    camera: bakeOf(shot),
    frames: allFrames(shot),
    attempt: { engine: 'eevee', device: null, samples: 64 },
    hdriPath: null,
    framesDirectory: fixtureFramesDirectory,
    outputStem: 'f',
    still: false,
    ...overrides,
  };
}

/** The resolved scene of a shot with the given overrides. */
export function sceneFor(shot: Shot, overrides: Partial<ResolveSceneInputs> = {}): BlenderScene {
  return resolveScene(inputsFor(shot, overrides));
}
