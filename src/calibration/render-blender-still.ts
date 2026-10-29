/**
 * Renders one frame of a blender-lane shot through the production path
 * (src/render/blender-shot.ts: the resolver, the validated scene document,
 * Blender, the success predicate, the manifest) without a job, the way
 * render-still.ts renders one frame of a browser-lane shot. The M5
 * calibration and lookdev probes share it, so their stills come from
 * exactly the code the still command runs, with the one attempt the
 * caller names (the probes pick the engine; the still command runs the
 * ladder). The frame is copied out of the scratch cache to outPng.
 */
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../cli/logger.ts';
import { ensureDirectory } from '../fs/paths.ts';
import type { LadderAttempt } from '../lanes/blender/ladder.ts';
import { laneFingerprint, shotKey } from '../plan/shot-key.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { blenderFingerprint, realBlenderSeams, renderBlenderShot } from '../render/blender-shot.ts';
import type { BlenderRenderTools } from '../render/blender-shot.ts';
import { framePath } from '../render/cache.ts';
import type { RenderSpec } from '../shared/camera/types.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { Lighting, RenderProfile, Shot } from '../shared/contracts/shot-spec.ts';
import { calibrationShot, focusedAtSubject } from './shots.ts';

/** What renderBlenderStill needs. */
export interface BlenderStillOptions {
  /** The shot, on the blender lane. */
  readonly shot: Shot;
  readonly look: LookBible;
  readonly spec: RenderSpec;
  /** The frame written to outPng. */
  readonly frame: number;
  /** The engine, device and samples to render with (src/lanes/blender/ladder.ts ladderAttempt). */
  readonly attempt: LadderAttempt;
  /** ffmpeg and Blender as doctor recorded them (src/render/blender-shot.ts readBlenderTools). */
  readonly tools: BlenderRenderTools;
  /** The data directory: Blender's user resources live under it and its tools.json names the Blender series the key folds in. */
  readonly dataDir: string;
  /** The installed HDRI for the world, or null for the flat world (blenderHdriPath). */
  readonly hdriPath: string | null;
  /** When "calibration", the patches and spheres of ADR 0008 replace the subject. */
  readonly scene?: 'calibration';
  readonly outPng: string;
  /** Scratch folder the shot cache is created under; the caller removes it. */
  readonly workDir: string;
  readonly runner: ProcessRunner;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

/** What renderBlenderStill reports beside the PNG. */
export interface BlenderStillResult {
  readonly png: string;
  readonly profile: RenderProfile;
  /** From the call to the frame hashed into the manifest: Blender's start, the shader compile, the render and the framehash. */
  readonly elapsedMs: number;
  /** The scratch cache the frame was rendered into, with the scene document and Blender's logs beside it. */
  readonly cacheDir: string;
}

/** The calibration scene's shot on the blender lane: the fixture's bottle held still under the lighting, focused on the patches' plane (src/calibration/shots.ts). */
export function blenderCalibrationShot(lighting: Lighting, spec: RenderSpec): Shot {
  // calibrationShot is typed for the browser lanes; every other field of the shot is the same on the blender lane.
  return focusedAtSubject(calibrationShot('blender', lighting), spec);
}

/** Renders the frame with the attempt into a scratch cache under workDir and copies it to outPng. */
export async function renderBlenderStill(options: BlenderStillOptions): Promise<BlenderStillResult> {
  const cacheDir = ensureDirectory(join(options.workDir, options.attempt.name));
  const key = await shotKey(options.shot, options.look, await laneFingerprint(options.dataDir, 'blender'));
  const result = await renderBlenderShot({
    seams: realBlenderSeams, shot: options.shot, look: options.look, spec: options.spec, frames: [options.frame], cacheDir, key,
    fingerprint: blenderFingerprint(options.tools.blender.version, options.tools.ffmpeg.version), attempt: options.attempt,
    blenderPath: options.tools.blender.path, dataDir: options.dataDir, hdriPath: options.hdriPath, ...(options.scene === undefined ? {} : { scene: options.scene }),
    runner: options.runner, ffmpegPath: options.tools.ffmpeg.path, log: options.log, signal: options.signal, now: (): Date => new Date(),
  });
  copyFileSync(framePath(result.framesDir, options.frame), options.outPng);
  return { png: options.outPng, profile: result.profile, elapsedMs: result.elapsedMs, cacheDir };
}
