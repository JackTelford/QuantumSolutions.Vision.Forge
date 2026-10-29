/**
 * The shot hash of ADR 0006 decision 8: the key that names a shot's cache
 * folder and tells a later run whether a rendered shot is still valid. It
 * covers the shot (its render profile included), the look bible, the lane
 * code hash, the browser's major version and the launch-flag set, so a
 * weekly browser patch does not invalidate every cached shot while a change
 * to any input does. The exact browser build is recorded in the render
 * manifest's fingerprint, not here.
 */
import { existsSync } from 'node:fs';
import { laneCodeHash } from '../lanes/lane-code-hash.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { Lane, Shot } from '../shared/contracts/shot-spec.ts';
import type { ToolsManifest } from '../shared/contracts/tools.ts';
import { contentHash } from '../shared/sha256.ts';
import { readToolsManifest, toolsManifestPath } from '../tools/tools-manifest.ts';

/**
 * The launch-flag set every shot key records and the harness launches with
 * (ADR 0006 decision 3, amended 2026-10-29); the `--use-angle` choice is
 * added by src/harness/types.ts and recorded by the shot's render profile.
 */
export const browserLaunchFlags: readonly string[] = ['--force-device-scale-factor=1', '--disable-lcd-text'];

/** The part of the render environment that enters a shot key. */
export interface RenderFingerprint {
  /**
   * Content hash of the lane sources (src/lanes/lane-code-hash.ts) as 64
   * lowercase hex characters, so a change to rendering code invalidates
   * the cache; the empty string before a lane is chosen (renderFingerprint)
   * and filled per shot by laneFingerprint.
   */
  readonly laneCodeHash: string;
  /** Major version of the browser the lanes launch, for example 156; null when doctor found no browser with a WebGL report. */
  readonly browserMajor: number | null;
  /** The launch flags, in order; empty when there is no tools manifest. */
  readonly browserFlags: readonly string[];
}

/** The fingerprint used when the data directory has no tools.json: nothing is known about the render environment yet. */
export const emptyFingerprint: RenderFingerprint = { laneCodeHash: '', browserMajor: null, browserFlags: [] };

/** The major version of a dotted browser version such as "156.0.4314.42"; null when the text does not start with a number. */
export function majorVersion(version: string): number | null {
  const match = /^(\d+)(?:\.|$)/.exec(version);
  return match === null ? null : Number(match[1]);
}

/** The fingerprint a tools manifest gives: the major version of the first browser with a WebGL report (else the first browser found, Edge before Chrome, the one that renders), and the launch flags. */
export function fingerprintFromManifest(manifest: ToolsManifest): RenderFingerprint {
  const browser = manifest.browsers.find((candidate) => candidate.webgl !== null) ?? manifest.browsers[0];
  return {
    laneCodeHash: '',
    browserMajor: browser === undefined ? null : majorVersion(browser.version),
    browserFlags: [...browserLaunchFlags],
  };
}

/** The render fingerprint for a data directory: from tools.json when doctor has written it, the empty fingerprint otherwise. */
export function renderFingerprint(dataDir: string): RenderFingerprint {
  if (!existsSync(toolsManifestPath(dataDir))) return emptyFingerprint;
  return fingerprintFromManifest(readToolsManifest(dataDir));
}

/** The render fingerprint of a data directory with the lane's code hash filled in: what plan, still and render all key a shot of that lane with. */
export async function laneFingerprint(dataDir: string, lane: Lane): Promise<RenderFingerprint> {
  return { ...renderFingerprint(dataDir), laneCodeHash: await laneCodeHash(lane) };
}

/** The look bible without its timestamp: rewriting the same look at another time must not re-key every shot. */
export function lookContent(look: LookBible): Omit<LookBible, 'createdAt'> {
  const { createdAt: _createdAt, ...content } = look;
  return content;
}

/** What a shot key hashes, in the shape it is canonicalized in. */
export interface ShotKeyInput {
  readonly shot: Shot;
  readonly look: Omit<LookBible, 'createdAt'>;
  readonly laneCodeHash: string;
  readonly browserMajor: number | null;
  readonly browserFlags: readonly string[];
}

/** The value a shot key is the content hash of. */
export function shotKeyInput(shot: Shot, look: LookBible, fingerprint: RenderFingerprint): ShotKeyInput {
  return {
    shot,
    look: lookContent(look),
    laneCodeHash: fingerprint.laneCodeHash,
    browserMajor: fingerprint.browserMajor,
    browserFlags: fingerprint.browserFlags,
  };
}

/** The shot key: SHA-256 of the canonical JSON of the shot, the look (without createdAt) and the fingerprint, as 64 lowercase hex characters. */
export function shotKey(shot: Shot, look: LookBible, fingerprint: RenderFingerprint): Promise<string> {
  return contentHash(shotKeyInput(shot, look, fingerprint));
}
