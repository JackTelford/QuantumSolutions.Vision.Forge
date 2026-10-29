/**
 * Renders the frames of one shot into its cache folder and keeps the
 * manifest current while it does. The work is resumable because every
 * frame is a pure function of its number (ADR 0006): an existing manifest
 * whose key and fingerprint match is read, every frame it already hashed
 * (and whose PNG is still there) is skipped, the rest are captured in one
 * browser session, hashed with ffmpeg framehash in batches of thirty and
 * appended to the manifest after each batch, so an interrupted run loses
 * at most thirty frames of work. A failure marks the manifest failed with
 * the frames hashed so far kept, and rethrows; a failed hash batch stops
 * the capture at the next frame rather than after the whole shot. A run
 * that finds every requested frame in a complete manifest touches nothing.
 */
import { existsSync } from 'node:fs';
import type { Logger } from '../cli/logger.ts';
import { ensureDirectory } from '../fs/paths.ts';
import type { BrowserRenderer, CapturedFrame } from '../harness/types.ts';
import type { EnvironmentRef, InitReport } from '../shared/harness/protocol.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { RenderSpec } from '../shared/camera/types.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { RenderManifest } from '../shared/contracts/render-manifest.ts';
import type { Shot } from '../shared/contracts/shot-spec.ts';
import { assertCachePathLength, framePath, framePattern, framesDir, manifestPath } from './cache.ts';
import { hashFrames } from './framehash.ts';
import { addFrames, complete, fail, fingerprintHash, hasEveryFrame, hashedFrames, isComplete, newManifest, readManifest, writeManifest } from './manifest.ts';
import type { FrameEntry, ManifestFingerprint } from './manifest.ts';
import type { PageSeam } from './seams.ts';
import { buildShotPageSpec } from './shot-page-spec.ts';

/** How many captured frames are hashed and recorded at a time. */
export const manifestBatchSize = 30;

/** What renderShot needs. */
export interface RenderShotInputs {
  readonly renderer: BrowserRenderer;
  readonly page: PageSeam;
  readonly harnessUrl: string;
  /** The directory the harness serves under /page/; the page is written there first. */
  readonly pageDir: string;
  readonly shot: Shot;
  readonly look: LookBible;
  readonly spec: RenderSpec;
  /** The frames to render, in the order to capture them. */
  readonly frames: readonly number[];
  readonly cacheDir: string;
  /** The shot key the cache folder is named after. */
  readonly key: string;
  readonly fingerprint: ManifestFingerprint;
  readonly runner: ProcessRunner;
  readonly ffmpegPath: string;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  /** Receives the page's init report when a browser session is opened for this shot (not when every frame is reused). */
  readonly onInit?: (report: InitReport) => void;
  /** The installed environment map of the shot, or null for the lane's built-in one. */
  readonly environment?: EnvironmentRef | null;
}

/** What renderShot reports. */
export interface RenderShotResult {
  readonly manifestPath: string;
  readonly framesDir: string;
  readonly framePattern: string;
  /** How many frames were asked for. */
  readonly frames: number;
  readonly elapsedMs: number;
  /** Elapsed time per captured frame; 0 when every frame was reused. */
  readonly msPerFrame: number;
  /** The median screenshot time of the captured frames; 0 when none was captured. */
  readonly screenshotMsMedian: number;
  /** How many requested frames were already hashed and kept. */
  readonly reused: number;
}

/** The middle value of a list; 0 for an empty one. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * The manifest to continue from: the one on disk, as it is, when it is
 * readable and records the same key and fingerprint, otherwise a fresh one.
 * A manifest that does not validate is reported and replaced, never
 * trusted.
 */
export async function resumableManifest(inputs: RenderShotInputs, path: string): Promise<RenderManifest> {
  const fresh = (): Promise<RenderManifest> => newManifest({
    shotId: inputs.shot.id,
    key: inputs.key,
    lane: inputs.shot.lane,
    renderProfile: inputs.renderer.profile,
    fingerprint: inputs.fingerprint,
    fps: inputs.spec.fps,
    width: inputs.spec.width,
    height: inputs.spec.height,
    frameCount: inputs.shot.durationFrames,
    startedAt: inputs.now().toISOString(),
  });
  if (!existsSync(path)) return fresh();
  let existing: RenderManifest;
  try {
    existing = readManifest(path);
  } catch (error: unknown) {
    inputs.log.warn(`${path} is not a valid manifest and is replaced: ${error instanceof Error ? error.message : String(error)}`);
    return fresh();
  }
  const sameInputs = existing.key === inputs.key && existing.toolVersionsHash === await fingerprintHash(inputs.fingerprint) && existing.frameCount === inputs.shot.durationFrames;
  if (!sameInputs) {
    inputs.log.info(`${path} was rendered under another key or fingerprint; rendering shot "${inputs.shot.id}" afresh`);
    return fresh();
  }
  // A failed or partial manifest keeps its hashed frames: each is a pure function of its number, so they are still right.
  return existing;
}

/** The manifest back in the rendering state: finishedAt is absent while rendering (the schema), so a reverted one drops it. */
export function revertToRendering(manifest: RenderManifest): RenderManifest {
  const { finishedAt: _finishedAt, ...rest } = manifest;
  return { ...rest, status: 'rendering' };
}

/** The requested frames whose hash is recorded and whose PNG exists; everything else is captured. */
export function reusableFrames(manifest: RenderManifest, framesDirectory: string, frames: readonly number[]): readonly number[] {
  const hashed = hashedFrames(manifest);
  return frames.filter((frame) => hashed.has(frame) && existsSync(framePath(framesDirectory, frame)));
}

/** Hashes a batch of captured frames and appends them to the manifest on disk. */
async function recordBatch(inputs: RenderShotInputs, manifest: RenderManifest, path: string, framesDirectory: string, batch: readonly number[]): Promise<RenderManifest> {
  const hashes = await hashFrames(inputs.runner, inputs.ffmpegPath, framesDirectory, batch, inputs.signal);
  const entries: FrameEntry[] = batch.map((frame) => ({ index: frame, sha256: hashes.get(frame) ?? '' }));
  const updated = addFrames(manifest, entries);
  writeManifest(path, updated);
  return updated;
}

/** Renders the missing frames of the shot, keeps the manifest current and reports what happened. */
export async function renderShot(inputs: RenderShotInputs): Promise<RenderShotResult> {
  const started = inputs.now().getTime();
  assertCachePathLength(inputs.cacheDir);
  const framesDirectory = ensureDirectory(framesDir(inputs.cacheDir));
  ensureDirectory(inputs.pageDir);
  inputs.page.writeShotPage(inputs.pageDir, inputs.spec.width, inputs.spec.height);
  const path = manifestPath(inputs.cacheDir);
  const existing = await resumableManifest(inputs, path);
  const reused = reusableFrames(existing, framesDirectory, inputs.frames);
  const kept = new Set(reused);
  const toCapture = inputs.frames.filter((frame) => !kept.has(frame));
  inputs.log.debug(`shot "${inputs.shot.id}": ${reused.length} frame(s) reused, ${toCapture.length} to capture`);
  const result = (screenshotMs: readonly number[]): RenderShotResult => {
    const elapsedMs = inputs.now().getTime() - started;
    return {
      manifestPath: path,
      framesDir: framesDirectory,
      framePattern: framePattern(framesDirectory),
      frames: inputs.frames.length,
      elapsedMs,
      msPerFrame: toCapture.length === 0 ? 0 : elapsedMs / toCapture.length,
      screenshotMsMedian: median(screenshotMs),
      reused: reused.length,
    };
  };
  // A finished shot whose frames are all there is left alone, so its finishedAt keeps saying when the frames were made.
  if (toCapture.length === 0 && isComplete(existing, inputs.shot.durationFrames)) return result([]);

  let manifest = revertToRendering(existing);
  writeManifest(path, manifest);
  const screenshotMs: number[] = [];
  try {
    if (toCapture.length > 0) {
      // Batches are hashed while the browser goes on capturing; the chain keeps the manifest writes in order.
      let pending: Promise<void> = Promise.resolve();
      let batch: number[] = [];
      let failed = false;
      let failure: unknown;
      const flush = (): void => {
        if (batch.length === 0) return;
        const frames = batch;
        batch = [];
        pending = pending.then(async () => { manifest = await recordBatch(inputs, manifest, path, framesDirectory, frames); });
        // A side branch records the failure as soon as it happens (and keeps the rejection handled); the chain itself still rejects below.
        pending.catch((error: unknown) => { failed = true; failure = error; });
      };
      const onFrame = (captured: CapturedFrame): void => {
        // A hash batch that failed ends the capture here: the renderer lets this throw out of capture.
        if (failed) throw failure;
        screenshotMs.push(captured.screenshotMs);
        batch.push(captured.frame);
        if (batch.length >= manifestBatchSize) flush();
      };
      const request = {
        pageUrl: inputs.page.pageUrl(inputs.harnessUrl),
        spec: buildShotPageSpec(inputs.shot, inputs.look, inputs.spec, inputs.environment ?? null),
        frames: toCapture,
        framePath: (frame: number): string => framePath(framesDirectory, frame),
        ...(inputs.onInit === undefined ? {} : { onInit: inputs.onInit }),
      };
      try {
        await inputs.renderer.capture(request, inputs.signal, onFrame);
      } finally {
        // Whatever happened in the browser, the frames that did land are hashed and kept.
        flush();
        await pending.catch(() => undefined);
      }
      await pending;
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
  return result(screenshotMs);
}
