/**
 * What the still and render commands share: the renderer policy argument,
 * the tools the browser lanes need from tools.json, the fingerprint the
 * shot key is computed with, the renderer-versus-pinned-profile rule, and
 * the frame-range argument. Pure except for the tools.json read.
 */
import { UsageError, ToolMissingError, VisionForgeError } from '../errors/vision-forge-error.ts';
import { rendererPolicies } from '../harness/types.ts';
import type { RendererPolicy } from '../harness/types.ts';
import { renderFingerprint } from '../plan/shot-key.ts';
import type { RenderFingerprint } from '../plan/shot-key.ts';
import type { Lane, RenderProfile, Shot } from '../shared/contracts/shot-spec.ts';
import type { Browser, FfmpegProgram } from '../shared/contracts/tools.ts';
import { browserHint } from '../tools/browsers.ts';
import { ffmpegHint } from '../tools/ffmpeg.ts';
import { readToolsManifest } from '../tools/tools-manifest.ts';
import type { RenderSeams } from './seams.ts';

/** The renderer policy from --renderer; `any` when absent, a usage error when it is not one of the three. */
export function parseRendererPolicy(value: string | undefined): RendererPolicy {
  if (value === undefined) return 'any';
  if ((rendererPolicies as readonly string[]).includes(value)) return value as RendererPolicy;
  throw new UsageError(`--renderer must be one of ${rendererPolicies.join(', ')}; got "${value}".`, 'Pass --renderer hardware, --renderer software or --renderer any (the default).');
}

/** The programs the browser lanes render and hash with, as doctor recorded them. */
export interface RenderTools {
  readonly ffmpeg: FfmpegProgram;
  /** The browser the shot key names (src/plan/shot-key.ts): the first with a WebGL report, else the first doctor found, Edge before Chrome. */
  readonly browser: Browser;
}

/** Reads tools.json and picks ffmpeg and the browser; a missing one is a ToolMissingError with the install hint. */
export function readRenderTools(dataDir: string): RenderTools {
  const manifest = readToolsManifest(dataDir);
  const ffmpeg = manifest.programs.ffmpeg;
  if (ffmpeg === undefined) throw new ToolMissingError('ffmpeg', ffmpegHint());
  // The same choice as fingerprintFromManifest, so the browser major the key records is the browser that renders.
  const browser = manifest.browsers.find((candidate) => candidate.webgl !== null) ?? manifest.browsers[0];
  if (browser === undefined) throw new ToolMissingError('A browser (Microsoft Edge or Google Chrome)', browserHint());
  return { ffmpeg, browser };
}

/** The fingerprint a shot key is computed with: the tools manifest's browser major and flags plus the lane's code hash, the same value plan uses (src/plan/shot-key.ts laneFingerprint) taken through the seams so tests can fake the hash. */
export async function keyFingerprint(dataDir: string, lane: Lane, seams: RenderSeams): Promise<RenderFingerprint> {
  return { ...renderFingerprint(dataDir), laneCodeHash: await seams.laneCodeHash(lane) };
}

/** The renderer policy and a shot's pinned profile disagree, or two pinned shots disagree with each other. */
export class RenderProfileMismatchError extends VisionForgeError {
  constructor(message: string) {
    super({
      code: 'render-profile-mismatch',
      message,
      hint: 'render keeps the renderer the still gate pinned (ADR 0004 decision 6). Pass --renderer any to adopt it, or run still again with the renderer you want.',
    });
  }
}

/**
 * The policy to launch with, given the policy asked for and the profiles
 * the still gate pinned: a pinned renderer wins under `any`; a fixed
 * policy must equal every pinned renderer; two pinned shots must agree,
 * since one browser renders them all.
 */
export function effectivePolicy(policy: RendererPolicy, shots: readonly Shot[]): RendererPolicy {
  let pinned: RenderProfile | undefined;
  let pinnedShot = '';
  for (const shot of shots) {
    const profile = shot.renderProfile;
    if (profile === null) continue;
    if (pinned !== undefined && pinned.renderer !== profile.renderer) {
      throw new RenderProfileMismatchError(`Shot "${pinnedShot}" was pinned to the ${pinned.renderer} renderer and shot "${shot.id}" to the ${profile.renderer} renderer; one browser renders every shot of a run.`);
    }
    if (policy !== 'any' && policy !== profile.renderer) {
      throw new RenderProfileMismatchError(`Shot "${shot.id}" was pinned to the ${profile.renderer} renderer by the still gate, but --renderer ${policy} was asked for.`);
    }
    pinned = profile;
    pinnedShot = shot.id;
  }
  return pinned === undefined ? policy : pinned.renderer;
}

/** Throws RenderProfileMismatchError when the browser that opened does not render the way a shot was pinned (policy `any` on a machine whose browser changed). */
export function assertRendererMatches(actual: RenderProfile, shots: readonly Shot[]): void {
  for (const shot of shots) {
    const profile = shot.renderProfile;
    if (profile !== null && profile.renderer !== actual.renderer) {
      throw new RenderProfileMismatchError(`The browser opened with the ${actual.renderer} renderer (${actual.backend}), but shot "${shot.id}" was pinned to ${profile.renderer} (${profile.backend}).`);
    }
  }
}

/** An inclusive frame range from --frames. */
export interface FrameRange {
  readonly first: number;
  readonly last: number;
}

/** Parses `a-b` from --frames; undefined when absent, a usage error when it is not two whole numbers with a ≤ b. */
export function parseFrameRange(value: string | undefined): FrameRange | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)-(\d+)$/.exec(value.trim());
  if (match === null) throw new UsageError(`--frames must be <first>-<last>, for example 0-11; got "${value}".`, 'Pass two whole frame numbers separated by a hyphen, first no larger than last.');
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (first > last) throw new UsageError(`--frames ${value} runs backwards.`, 'Pass the smaller frame number first, for example 0-11.');
  return { first, last };
}

/** The frames of a shot to render: the whole shot, or the --frames range, which must lie inside the shot. */
export function framesOf(shot: Shot, range: FrameRange | undefined): readonly number[] {
  const last = shot.durationFrames - 1;
  if (range !== undefined && range.last > last) {
    throw new UsageError(`--frames ${range.first}-${range.last} is out of range for shot "${shot.id}", which has frames 0 to ${last}.`, `Pass --frames within 0-${last}.`);
  }
  const first = range?.first ?? 0;
  const end = range?.last ?? last;
  return Array.from({ length: end - first + 1 }, (_, index) => first + index);
}

/** A frame number from --frame, checked against the shot; undefined when absent. */
export function parseStillFrame(value: number | undefined, shot: Shot): number | undefined {
  if (value === undefined) return undefined;
  const last = shot.durationFrames - 1;
  if (!Number.isInteger(value) || value < 0 || value > last) {
    throw new UsageError(`--frame ${String(value)} is out of range for shot "${shot.id}", which has frames 0 to ${last}.`, `Pass --frame within 0-${last}, or leave it out for the default still frame.`);
  }
  return value;
}

/** The scale factor from --scale: 1 when absent, a whole number of 1 or more otherwise. */
export function parseScale(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1) throw new UsageError(`--scale must be a whole number of 1 or more; got ${String(value)}.`, 'Pass --scale 2 for a double-size still beside the normal one.');
  return value;
}
