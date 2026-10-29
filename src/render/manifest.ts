/**
 * The render manifest (schemas/render-manifest.schema.json): what one shot
 * render produced and under which fingerprint (ADR 0006 decision 5). It is
 * written next to the frames, grows while frames are hashed, and is what a
 * later run reads to resume or to reuse a finished shot. Every function
 * here is pure except the two that touch the file, and both validate
 * against the schema so a manifest on disk is always one the schema accepts.
 */
import { readJsonFile, writeJsonAtomic } from '../fs/atomic-json.ts';
import { validateDocument } from '../schema/validator.ts';
import type { Lane, RenderManifest } from '../shared/contracts/render-manifest.ts';
import type { RenderProfile } from '../shared/contracts/shot-spec.ts';
import { toolVersionsHash } from '../harness/fingerprint.ts';

/** The document kind of a render manifest. */
export const manifestKind = 'render-manifest';

/** The fingerprint a manifest records: everything that influences pixels. */
export type ManifestFingerprint = RenderManifest['fingerprint'];

/** One hashed frame. */
export type FrameEntry = RenderManifest['frames'][number];

/** What a fresh manifest is built from. */
export interface ManifestInputs {
  readonly shotId: string;
  /** The shot key, 64 lowercase hex characters; names the cache folder. */
  readonly key: string;
  readonly lane: Lane;
  readonly renderProfile: RenderProfile;
  readonly fingerprint: ManifestFingerprint;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  /** How many frames the shot has in total, whatever subset this run renders. */
  readonly frameCount: number;
  /** RFC 3339 timestamp of the render start. */
  readonly startedAt: string;
}

/**
 * SHA-256 of the canonical JSON of a fingerprint, as the schema defines
 * toolVersionsHash: equal fingerprints hash alike, so a resume compares
 * one string instead of every field. The same function the harness
 * exports as toolVersionsHash.
 */
export function fingerprintHash(fingerprint: ManifestFingerprint): Promise<string> {
  return toolVersionsHash(fingerprint);
}

/** A manifest in the rendering state with no frames yet. */
export async function newManifest(inputs: ManifestInputs): Promise<RenderManifest> {
  return {
    kind: manifestKind,
    version: 1,
    shotId: inputs.shotId,
    key: inputs.key,
    lane: inputs.lane,
    renderProfile: { ...inputs.renderProfile },
    fingerprint: structuredClone(inputs.fingerprint),
    fps: inputs.fps,
    width: inputs.width,
    height: inputs.height,
    frameCount: inputs.frameCount,
    frames: [],
    status: 'rendering',
    startedAt: inputs.startedAt,
    toolVersionsHash: await fingerprintHash(inputs.fingerprint),
  };
}

/** The manifest with the entries added, replacing any entry of the same index, kept in index order. */
export function addFrames(manifest: RenderManifest, entries: readonly FrameEntry[]): RenderManifest {
  const byIndex = new Map<number, FrameEntry>();
  for (const entry of manifest.frames) byIndex.set(entry.index, entry);
  for (const entry of entries) byIndex.set(entry.index, { index: entry.index, sha256: entry.sha256 });
  const frames = [...byIndex.values()].sort((a, b) => a.index - b.index);
  return { ...manifest, frames };
}

/** The manifest marked complete at the given time. */
export function complete(manifest: RenderManifest, finishedAt: string): RenderManifest {
  return { ...manifest, status: 'complete', finishedAt };
}

/** The manifest marked failed at the given time; the frames already hashed stay, so the next run resumes from them. */
export function fail(manifest: RenderManifest, finishedAt: string): RenderManifest {
  return { ...manifest, status: 'failed', finishedAt };
}

/** The frame numbers the manifest holds a hash for. */
export function hashedFrames(manifest: RenderManifest): ReadonlySet<number> {
  return new Set(manifest.frames.map((entry) => entry.index));
}

/** The requested frames the manifest has no hash for yet, in the order requested. */
export function missingFrames(manifest: RenderManifest, frames: readonly number[]): readonly number[] {
  const hashed = hashedFrames(manifest);
  return frames.filter((frame) => !hashed.has(frame));
}

/** True when the manifest is complete and holds a hash for every frame 0 to frameCount − 1 of a shot with that many frames. */
export function isComplete(manifest: RenderManifest, frameCount: number): boolean {
  if (manifest.status !== 'complete' || manifest.frameCount !== frameCount) return false;
  const hashed = hashedFrames(manifest);
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (!hashed.has(frame)) return false;
  }
  return true;
}

/** True when every frame 0 to frameCount − 1 has a hash, whatever the status says. */
export function hasEveryFrame(manifest: RenderManifest): boolean {
  return missingFrames(manifest, Array.from({ length: manifest.frameCount }, (_, frame) => frame)).length === 0;
}

/** Validates the manifest against its schema and writes it atomically. */
export function writeManifest(path: string, manifest: RenderManifest): void {
  validateDocument(manifestKind, manifest);
  writeJsonAtomic(path, manifest);
}

/** Reads a manifest and validates it against its schema. */
export function readManifest(path: string): RenderManifest {
  const document = readJsonFile(path);
  validateDocument(manifestKind, document);
  return document as RenderManifest;
}
