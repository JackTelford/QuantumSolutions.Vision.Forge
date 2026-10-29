/**
 * Renders the frames of one blender-lane shot into its cache folder with
 * one chosen attempt of the ladder (src/lanes/blender/ladder.ts), keeping
 * the same cache layout, manifest and result shape as the browser path in
 * render-shot.ts, so render, still and the assembly read both alike. The
 * frames to render are cut into contiguous batches (batches.ts); for each
 * batch the resolver turns the shot, the look, the bake and the attempt
 * into a scene document, which is validated, written under
 * <cacheDir>/scene/<attempt>/<first>-<last>/ beside Blender's logs and
 * handed to Blender (runner.ts); the
 * success predicate (success.ts) decides whether the batch rendered; the
 * frames are hashed with ffmpeg framehash and appended to the manifest.
 * The first batch is timed for the estimate. A failed batch marks the
 * manifest failed with the frames hashed so far kept and throws the
 * predicate's error, which the ladder at the still gate reads to try the
 * next rung and which render reports as it is.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../cli/logger.ts';
import { ToolMissingError, ToolVersionError } from '../errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../fs/atomic-json.ts';
import { ensureDirectory } from '../fs/paths.ts';
import { planBatches } from '../lanes/blender/batches.ts';
import { estimateFromBatch } from '../lanes/blender/estimator.ts';
import type { RenderEstimate } from '../lanes/blender/estimator.ts';
import type { LadderAttempt } from '../lanes/blender/ladder.ts';
import { cacheOutputStem, resolveScene } from '../lanes/blender/resolve-scene.ts';
import type { ResolveSceneInputs } from '../lanes/blender/resolve-scene.ts';
import { batchTimeoutMs, blenderArgs, runBlender } from '../lanes/blender/runner.ts';
import { writeSceneDocument } from '../lanes/blender/scene-file.ts';
import type { WrittenScene } from '../lanes/blender/scene-file.ts';
import { crashLogMtime, crashLogPath, judgeBlenderRun, verdictError } from '../lanes/blender/success.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { validateDocument } from '../schema/validator.ts';
import { bake } from '../shared/camera/bake.ts';
import type { CameraFrame, RenderSpec } from '../shared/camera/types.ts';
import { solveBasePose } from '../shared/composition/solver.ts';
import type { BlenderScene } from '../shared/contracts/blender-scene.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { RenderManifest } from '../shared/contracts/render-manifest.ts';
import type { RenderProfile, Shot } from '../shared/contracts/shot-spec.ts';
import type { BlenderProgram, FfmpegProgram } from '../shared/contracts/tools.ts';
import { blenderInstallHint, describeUnsupportedBlender, isSupportedBlenderVersion, supportedBlenderSeries } from '../tools/blender.ts';
import { ffmpegHint } from '../tools/ffmpeg.ts';
import { readToolsManifest } from '../tools/tools-manifest.ts';
import { assertCachePathLength, framePath, framePattern, framesDir, manifestPath } from './cache.ts';
import { hashFrames } from './framehash.ts';
import { addFrames, complete, fail, fingerprintHash, hasEveryFrame, isComplete, newManifest, readManifest, writeManifest } from './manifest.ts';
import type { FrameEntry, ManifestFingerprint } from './manifest.ts';
import { reusableFrames, revertToRendering } from './render-shot.ts';
import type { RenderShotResult } from './render-shot.ts';

/**
 * The resolver's inputs plus the purpose of the run: true for a still
 * (denoised, more samples), false for every batch of a clip, however
 * short, so a frame's pixels do not depend on where the batches were cut.
 * The resolver takes the flag from here once it has the field; until then
 * the intersection carries it past its input type.
 */
export type BlenderBatchSceneInputs = ResolveSceneInputs;

/** The two functions of the resolver module this file calls, as an interface so tests hand in a scene of their own. */
export interface BlenderSceneSeams {
  /** The closed scene document of one batch (src/lanes/blender/resolve-scene.ts). */
  resolveScene(inputs: BlenderBatchSceneInputs): BlenderScene;
  /** Writes the document atomically into the directory and returns its path and content hash (src/lanes/blender/scene-file.ts). */
  writeSceneDocument(dir: string, scene: BlenderScene): Promise<WrittenScene>;
}

/** The real resolver and writer. */
export const realBlenderSeams: BlenderSceneSeams = { resolveScene, writeSceneDocument };

/** What renderBlenderShot needs. */
export interface BlenderShotInputs {
  readonly seams: BlenderSceneSeams;
  readonly shot: Shot;
  readonly look: LookBible;
  readonly spec: RenderSpec;
  /** The frames to render, ascending. */
  readonly frames: readonly number[];
  readonly cacheDir: string;
  /** The shot key the cache folder is named after. */
  readonly key: string;
  readonly fingerprint: ManifestFingerprint;
  /** The one attempt this run renders with: the ladder's rung at the still gate, the pinned profile at render; it carries the purpose and the samples (ladder.ts). */
  readonly attempt: LadderAttempt;
  readonly blenderPath: string;
  readonly dataDir: string;
  readonly hdriPath: string | null;
  readonly scene?: 'calibration';
  readonly runner: ProcessRunner;
  readonly ffmpegPath: string;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  /** Where Blender writes its crash log; the platform's path when absent. */
  readonly crashLogPath?: string;
  /** The per-frame time allowance at 1080p; the CPU rung gets a longer one (cpuSecondsPerFrameAt1080p). */
  readonly secondsPerFrameAt1080p?: number;
}

/** What renderBlenderShot reports: the browser result's shape plus the profile that rendered and the estimate from the first batch. */
export interface BlenderShotResult extends RenderShotResult {
  readonly profile: RenderProfile;
  /** The estimate measured on the first batch when more than one batch ran; null otherwise. */
  readonly estimate: RenderEstimate | null;
}

/** The per-frame allowance for Cycles on the CPU, which the capabilities table puts at minutes per 1080p frame. */
export const cpuSecondsPerFrameAt1080p = 300;

/** The per-frame allowance for every GPU rung. */
export const gpuSecondsPerFrameAt1080p = 30;

/** The programs the blender lane renders and hashes with, as doctor recorded them. */
export interface BlenderRenderTools {
  readonly ffmpeg: FfmpegProgram;
  readonly blender: BlenderProgram;
  /** Whether doctor ran in a desktop session, which EEVEE's GPU context needs (ADR 0004). */
  readonly interactiveSession: boolean;
}

/** Reads tools.json and picks ffmpeg and Blender; a missing one is a ToolMissingError with the install hint, an unsupported Blender a ToolVersionError. */
export function readBlenderTools(dataDir: string): BlenderRenderTools {
  const manifest = readToolsManifest(dataDir);
  const ffmpeg = manifest.programs.ffmpeg;
  if (ffmpeg === undefined) throw new ToolMissingError('ffmpeg', ffmpegHint());
  const blender = manifest.programs.blender;
  if (blender === undefined) throw new ToolMissingError(`Blender ${supportedBlenderSeries} LTS`, blenderInstallHint());
  if (!isSupportedBlenderVersion(blender.version)) throw new ToolVersionError('Blender', blender.version, `${supportedBlenderSeries}.x`, describeUnsupportedBlender(blender.version, blender.path));
  return { ffmpeg, blender, interactiveSession: manifest.interactiveSession };
}

/** The Cycles device types doctor's probe recorded, each once; empty when the probe was skipped. */
export function blenderDeviceTypes(blender: BlenderProgram): readonly string[] {
  return [...new Set((blender.devices ?? []).map((device) => device.type))];
}

/** The manifest fingerprint of a Blender render: Node, ffmpeg and Blender; no browser or machine fields, which the schema reserves for the browser lanes. */
export function blenderFingerprint(blenderVersion: string, ffmpegVersion: string): ManifestFingerprint {
  return { node: process.version, ffmpeg: ffmpegVersion, blender: blenderVersion };
}

/** The sidecar beside the manifest that records every batch's scene document hash (the manifest schema is closed). */
export function sceneHashesPath(cacheDir: string): string {
  return join(cacheDir, 'scene-hashes.json');
}

/** One batch's scene document as the sidecar records it. */
export interface SceneHashEntry {
  readonly attempt: string;
  readonly first: number;
  readonly last: number;
  readonly path: string;
  readonly sha256: string;
}

/** Appends a batch's scene hash to the sidecar; a sidecar that does not parse is replaced. */
export function recordSceneHash(cacheDir: string, entry: SceneHashEntry): void {
  const path = sceneHashesPath(cacheDir);
  let batches: SceneHashEntry[] = [];
  if (existsSync(path)) {
    try {
      const parsed = readJsonFile(path) as { readonly batches?: unknown };
      if (Array.isArray(parsed.batches)) batches = parsed.batches as SceneHashEntry[];
    } catch {
      batches = [];
    }
  }
  writeJsonAtomic(path, { kind: 'blender-scene-hashes', batches: [...batches, entry] });
}

/** The manifest to continue from: the one on disk when it records the same key and fingerprint, else a fresh one with this run's profile (and no scene hashes from the old one beside it). */
async function resumableBlenderManifest(inputs: BlenderShotInputs, path: string): Promise<RenderManifest> {
  const fresh = (): Promise<RenderManifest> => {
    // The sidecar lists the batches of the manifest beside it; a manifest started afresh must not carry another Blender's batches along.
    rmSync(sceneHashesPath(inputs.cacheDir), { force: true });
    return newManifest({
      shotId: inputs.shot.id, key: inputs.key, lane: 'blender', renderProfile: inputs.attempt.profile, fingerprint: inputs.fingerprint,
      fps: inputs.spec.fps, width: inputs.spec.width, height: inputs.spec.height, frameCount: inputs.shot.durationFrames, startedAt: inputs.now().toISOString(),
    });
  };
  if (!existsSync(path)) return fresh();
  let existing: RenderManifest;
  try {
    existing = readManifest(path);
  } catch (error: unknown) {
    inputs.log.warn(`${path} is not a valid manifest and is replaced: ${error instanceof Error ? error.message : String(error)}`);
    return fresh();
  }
  const same = existing.key === inputs.key && existing.toolVersionsHash === await fingerprintHash(inputs.fingerprint) && existing.frameCount === inputs.shot.durationFrames;
  if (!same) {
    inputs.log.info(`${path} was rendered under another key or fingerprint; rendering shot "${inputs.shot.id}" afresh`);
    return fresh();
  }
  return existing;
}

/** The folder of one batch's scene document and Blender logs: <cacheDir>/scene/<attempt>/<first>-<last>, so every batch of an attempt keeps its own evidence. */
export function batchSceneDir(cacheDir: string, attemptName: string, first: number, last: number): string {
  return join(cacheDir, 'scene', attemptName, `${first}-${last}`);
}

/** Renders one batch with the attempt: scene document, Blender, predicate. Throws the predicate's error when the batch did not render. */
async function renderBatch(inputs: BlenderShotInputs, batch: readonly number[], camera: readonly CameraFrame[], framesDirectory: string): Promise<void> {
  const { attempt } = inputs;
  const first = batch[0] ?? 0;
  const last = batch[batch.length - 1] ?? first;
  const attemptDir = ensureDirectory(batchSceneDir(inputs.cacheDir, attempt.name, first, last));
  const scene = inputs.seams.resolveScene({
    shot: inputs.shot, look: inputs.look, spec: inputs.spec, camera, frames: batch, attempt: attempt.attempt, hdriPath: inputs.hdriPath,
    framesDirectory, outputStem: cacheOutputStem, still: attempt.purpose === 'still', ...(inputs.scene === undefined ? {} : { scene: inputs.scene }),
  });
  // The applier takes every number from the document, so a document the schema refuses must never reach it.
  validateDocument('blender-scene', scene);
  const written = await inputs.seams.writeSceneDocument(attemptDir, scene);
  recordSceneHash(inputs.cacheDir, { attempt: attempt.name, first, last, path: written.path, sha256: written.hash });
  const expected = batch.map((frame) => framePath(framesDirectory, frame));
  // A frame left by an earlier run would pass the existence check; only this run's files count.
  for (const path of expected) rmSync(path, { force: true });
  const timeoutMs = batchTimeoutMs(batch.length, inputs.spec.width, inputs.spec.height, inputs.secondsPerFrameAt1080p ?? (attempt.profile.renderer === 'software' ? cpuSecondsPerFrameAt1080p : gpuSecondsPerFrameAt1080p));
  const crashLog = inputs.crashLogPath ?? crashLogPath();
  const crashLogMtimeBefore = crashLogMtime(crashLog);
  // File write times are wall-clock, so the spawn time is too; the injected clock is for the manifest's timestamps.
  const spawnedAt = Date.now();
  const result = await runBlender({
    runner: inputs.runner, executable: inputs.blenderPath, dataDir: inputs.dataDir, cwd: framesDirectory, timeoutMs, signal: inputs.signal, log: inputs.log,
    args: blenderArgs({ backend: attempt.gpuBackend, eevee: attempt.attempt.engine === 'eevee', scenePath: written.path, outDir: framesDirectory.replace(/\\/g, '/') }),
    stdoutFile: join(attemptDir, 'blender-stdout.log'), stderrFile: join(attemptDir, 'blender-stderr.log'),
  });
  const verdict = await judgeBlenderRun({
    result, expectedFrames: expected, spawnedAt, crashLogPath: crashLog, crashLogMtimeBefore, runner: inputs.runner, ffmpegPath: inputs.ffmpegPath,
    statsPath: join(attemptDir, 'first-frame-yavg.txt'), signal: inputs.signal,
  });
  if (!verdict.ok) throw verdictError(verdict, written.path, timeoutMs);
  inputs.log.info(`blender ${attempt.name}: frames ${first}-${last} in ${(result.elapsedMs / 1000).toFixed(1)} s (exit ${result.exitCode ?? 'none'})`);
}

/** Hashes a rendered batch and appends it to the manifest on disk. */
async function recordBatch(inputs: BlenderShotInputs, manifest: RenderManifest, path: string, framesDirectory: string, batch: readonly number[]): Promise<RenderManifest> {
  const hashes = await hashFrames(inputs.runner, inputs.ffmpegPath, framesDirectory, batch, inputs.signal);
  const entries: FrameEntry[] = batch.map((frame) => ({ index: frame, sha256: hashes.get(frame) ?? '' }));
  const updated = addFrames(manifest, entries);
  writeManifest(path, updated);
  return updated;
}

/** Renders the missing frames of the shot with the attempt, keeps the manifest current and reports what happened. */
export async function renderBlenderShot(inputs: BlenderShotInputs): Promise<BlenderShotResult> {
  const started = inputs.now().getTime();
  assertCachePathLength(inputs.cacheDir);
  const framesDirectory = ensureDirectory(framesDir(inputs.cacheDir));
  const path = manifestPath(inputs.cacheDir);
  const existing = await resumableBlenderManifest(inputs, path);
  const reused = reusableFrames(existing, framesDirectory, inputs.frames);
  const kept = new Set(reused);
  const toRender = inputs.frames.filter((frame) => !kept.has(frame));
  inputs.log.debug(`shot "${inputs.shot.id}": ${reused.length} frame(s) reused, ${toRender.length} to render with ${inputs.attempt.name}`);
  const result = (estimate: RenderEstimate | null): BlenderShotResult => {
    const elapsedMs = inputs.now().getTime() - started;
    return {
      manifestPath: path, framesDir: framesDirectory, framePattern: framePattern(framesDirectory), frames: inputs.frames.length, elapsedMs,
      msPerFrame: toRender.length === 0 ? 0 : elapsedMs / toRender.length, screenshotMsMedian: 0, reused: reused.length, profile: inputs.attempt.profile, estimate,
    };
  };
  if (toRender.length === 0 && isComplete(existing, inputs.shot.durationFrames)) return result(null);

  let manifest = revertToRendering(existing);
  writeManifest(path, manifest);
  let estimate: RenderEstimate | null = null;
  try {
    if (toRender.length > 0) {
      const camera = bake(inputs.shot, inputs.spec, solveBasePose(inputs.shot, inputs.spec));
      const batches = planBatches(toRender);
      let rendered = 0;
      for (const batch of batches) {
        const batchStarted = inputs.now().getTime();
        await renderBatch(inputs, batch, camera, framesDirectory);
        manifest = await recordBatch(inputs, manifest, path, framesDirectory, batch);
        rendered += batch.length;
        if (estimate === null && batches.length > 1) {
          estimate = estimateFromBatch(inputs.now().getTime() - batchStarted, batch.length, toRender.length - rendered);
          inputs.log.info(`estimate: ${estimate.secondsPerFrame} s per frame, about ${estimate.totalSeconds} s for the remaining ${toRender.length - rendered} frame(s)`);
        }
      }
    }
    if (hasEveryFrame(manifest)) manifest = complete(manifest, inputs.now().toISOString());
    writeManifest(path, manifest);
  } catch (error: unknown) {
    try {
      writeManifest(path, fail(manifest, inputs.now().toISOString()));
    } catch (writeError: unknown) {
      inputs.log.warn(`Could not mark ${path} failed: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
    }
    throw error;
  }
  return result(estimate);
}
