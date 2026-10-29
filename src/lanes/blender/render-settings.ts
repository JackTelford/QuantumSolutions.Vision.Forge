/**
 * The output, render and colour-management sections of a blender-scene
 * document: where the frames go, which engine and how many samples (the
 * attempt ladder of ADR 0004 decision 6 chooses, this file writes), the
 * motion blur shutter and the view transform of ADR 0008. Pure functions
 * of their arguments.
 */
import type { CameraFrame, RenderSpec } from '../../shared/camera/types.ts';
import type { BlenderScene, ComputeDeviceType } from '../../shared/contracts/blender-scene.ts';
import type { LookBible } from '../../shared/contracts/look-bible.ts';
import type { Shot } from '../../shared/contracts/shot-spec.ts';
import { frameNumberDigits } from '../../render/cache.ts';

/** The engine an attempt of the ladder uses. */
export type AttemptEngine = 'eevee' | 'cycles';

/** The Cycles compute device of an attempt; null for an EEVEE attempt, which renders through the GPU context instead. */
export type AttemptDevice = 'OPTIX' | 'CUDA' | 'CPU' | null;

/** One rung of the attempt ladder: the engine, its device and the samples it renders with. */
export interface BlenderAttempt {
  readonly engine: AttemptEngine;
  readonly device: AttemptDevice;
  /** Render samples: EEVEE's taa_render_samples or Cycles' samples per pixel, 1 or more. */
  readonly samples: number;
}

/** EEVEE's samples for a clip and for a still. */
export const eeveeSamples = { clip: 64, still: 128 } as const;

/** Cycles' samples for a clip, for a still, and for a still at 4K width or more. */
export const cyclesSamples = { clip: 128, still: 128, still4k: 256 } as const;

/** The frame width from which a still is rendered with the 4K sample count. */
export const stillWidth4k = 3840;

/** The PNG bit depth of every frame: 8 bits per channel, what the browser lanes write and ffmpeg's framehash compares. */
export const frameColorDepth = '8';

/**
 * The samples an attempt renders with when the ladder has no reason to
 * differ: 64 for an EEVEE clip and 128 for an EEVEE still; 128 for Cycles,
 * 256 for a Cycles still at 4K width or more, where denoising alone leaves
 * the hero still too soft.
 */
export function defaultSamples(engine: AttemptEngine, still: boolean, width: number): number {
  if (engine === 'eevee') return still ? eeveeSamples.still : eeveeSamples.clip;
  if (!still) return cyclesSamples.clip;
  return width >= stillWidth4k ? cyclesSamples.still4k : cyclesSamples.still;
}

/** The file stem Blender fills the frame number into: the cache's prefix plus one # per digit, so frame 12 lands at f000012.png (src/render/cache.ts frameFileName). */
export function frameFileStem(outputStem: string): string {
  return `${outputStem}${'#'.repeat(frameNumberDigits)}`;
}

/** A path with forward slashes, which Blender takes on every platform and the schema asks for. */
export function forwardSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/** The output section: the frames directory, the stem, the contiguous frame range and the size at 100 percent. */
export function outputSettings(framesDirectory: string, outputStem: string, frames: readonly number[], spec: RenderSpec): BlenderScene['output'] {
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first === undefined || last === undefined) throw new RangeError('A Blender scene renders at least one frame.');
  return {
    directory: forwardSlashes(framesDirectory),
    fileStem: frameFileStem(outputStem),
    frameStart: first,
    frameEnd: last,
    fps: spec.fps,
    width: spec.width,
    height: spec.height,
    colorDepth: frameColorDepth,
  };
}

/**
 * The render section for an attempt. Both engines' settings are written
 * so the applier sets them without choosing: the attempt's samples go to
 * its own engine and the other engine gets its default. Denoising is on
 * for a still only: a clip denoised frame by frame flickers. The denoiser
 * is OptiX on an OptiX device, OpenImageDenoise elsewhere. A CPU or EEVEE
 * attempt records the CPU as the Cycles device so the preference list is
 * still a value, not a choice. Motion blur is on with the shutter of frame
 * 0 in frames (the angle over 360, so 180 degrees is 0.5); the shutter is
 * one scene setting in Blender and is not keyframed per frame, which is
 * right because the shot spec's shutter angle is one value per shot.
 */
export function renderSettings(attempt: BlenderAttempt, still: boolean, width: number, firstFrame: CameraFrame): BlenderScene['render'] {
  const gpuDevice: ComputeDeviceType = attempt.device === 'OPTIX' || attempt.device === 'CUDA' ? attempt.device : 'NONE';
  return {
    engine: attempt.engine === 'eevee' ? 'BLENDER_EEVEE' : 'CYCLES',
    eeveeSamples: attempt.engine === 'eevee' ? attempt.samples : defaultSamples('eevee', still, width),
    cycles: {
      samples: attempt.engine === 'cycles' ? attempt.samples : defaultSamples('cycles', still, width),
      useDenoising: still,
      denoiser: attempt.device === 'OPTIX' ? 'OPTIX' : 'OPENIMAGEDENOISE',
      device: gpuDevice === 'NONE' ? 'CPU' : 'GPU',
      computeDeviceType: gpuDevice,
      deviceTypes: [gpuDevice === 'NONE' ? 'CPU' : gpuDevice],
    },
    motionBlur: { enabled: true, shutter: firstFrame.shutterAngleDeg / 360 },
  };
}

/**
 * The colour management section: AgX for the agx tone mapping token,
 * Standard otherwise (ADR 0008 decision 2), with the base exposure of the
 * shot, the look's EV plus the shot's offset. The view exposure is one
 * scene setting; a per-frame exposure from the baked camera is not
 * keyframed here, and today the bake's exposureEv is the shot's offset on
 * every frame anyway (camera/bake.ts).
 */
export function colorManagement(look: Pick<LookBible, 'toneMapping' | 'exposureEv'>, shot: Pick<Shot, 'exposureOffsetEv'>): BlenderScene['colorManagement'] {
  return {
    viewTransform: look.toneMapping === 'agx' ? 'AgX' : 'Standard',
    exposure: look.exposureEv + shot.exposureOffsetEv,
  };
}
