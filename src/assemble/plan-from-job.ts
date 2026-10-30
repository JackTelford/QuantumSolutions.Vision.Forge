/**
 * The assembly plan built from a job, so nothing after the four planner
 * documents is written by hand: one clip per shot in shot-spec order read
 * from the shot's render cache, the shot spec's transitions (a cut has no
 * entry in a plan), the narration M6 synthesised into the job folder with
 * its captions, the music the user supplied, the look's grade and the
 * delivery encode. Pure given its inputs except for the one injected
 * reader of render manifests, which tests replace with a fake.
 *
 * A shot that is not rendered under the key the job records, with a
 * complete manifest, is a `shot-not-rendered` error rather than a clip of
 * missing frames: assemble runs after render, never instead of it. A shot
 * whose job entry names a text plate manifest gets that plate as the
 * clip's overlay, composited after the grade (ADR 0008 decision 4).
 */
import { hasTextPlate } from '../render/text-plate.ts';
import { dirname } from 'node:path';
import { ShotNotRenderedError } from '../errors/job-errors.ts';
import { SchemaValidationError } from '../errors/vision-forge-error.ts';
import { findJobShot } from '../render/job-state.ts';
import { framePattern, framesDir } from '../render/cache.ts';
import { isComplete } from '../render/manifest.ts';
import { runSemanticChecks } from '../schema/checks/index.ts';
import { validateDocument } from '../schema/validator.ts';
import type { AssemblyPlan, AudioMix, CaptionStyle, Captions, Clip, Codec, FinishingGrade, Transition } from '../shared/contracts/assembly-plan.ts';
import type { Job, JobShot } from '../shared/contracts/job.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { RenderManifest } from '../shared/contracts/render-manifest.ts';
import type { Shot, ShotSpec } from '../shared/contracts/shot-spec.ts';
import type { ClipOverlay } from './plate.ts';

/** The narration files the plan places: the subset of M6's narration.json that assembly reads. */
export interface NarrationFiles {
  /** Absolute path of the normalized narration WAV. */
  readonly wavPath: string;
  /** Absolute path of the captions SRT written beside it. */
  readonly srtPath: string;
}

/** The music the user supplied for the delivery. */
export interface MusicInput {
  readonly path: string;
  readonly gainDb: number;
}

/** What buildAssemblyPlan needs. */
export interface AssemblyPlanInputs {
  readonly job: Job;
  readonly shotSpec: ShotSpec;
  readonly look: LookBible;
  /** The narration synthesised into the job folder, or null when the piece has none. */
  readonly narration: NarrationFiles | null;
  readonly music: MusicInput | null;
  /** True to render the captions into the picture; false leaves the SRT as a sidecar beside the delivery. */
  readonly burnIn: boolean;
  /** Absolute path of the look's grade baked as a .cube; the caller writes the file. */
  readonly cubePath: string;
  /** Absolute path of the delivery file. */
  readonly outputPath: string;
  readonly codec: Codec;
  /** Reads a render manifest by path; the real one validates the file against its schema. */
  readonly readManifest: (path: string) => RenderManifest;
}

/** The delivery loudness targets (EBU R128 as streaming platforms apply it; the narration is mastered to the same numbers). */
export const deliveryLoudness: { readonly lufs: number; readonly truePeakDbtp: number } = { lufs: -16, truePeakDbtp: -1.5 };

/** The delivery encode defaults: CRF 16 at the medium preset, the index at the front so the file streams. */
export const deliveryEncode: { readonly crf: number; readonly preset: 'medium'; readonly faststart: boolean } = { crf: 16, preset: 'medium', faststart: true };

/** The music gain when the user names none, in decibels: a bed under narration, as the plan schema's own example puts it. */
export const defaultMusicGainDb = -12;

/** The file extension a codec's delivery takes: .mov for ProRes, .mp4 for H.264 and HEVC. */
export function deliveryExtension(codec: Codec): string {
  return codec === 'prores' ? '.mov' : '.mp4';
}

/** The frames pattern of the cache folder a manifest sits in: the manifest is `<cache>/manifest.json`, the frames `<cache>/frames/f%06d.png`. */
function framesSourceBeside(manifestPath: string): ClipOverlay {
  return { kind: 'frames', path: framePattern(framesDir(dirname(manifestPath))), startNumber: 0 };
}

/** Reads the manifest at the path and holds it to the shot: the job's key and every frame hashed; the reason is returned when it falls short. */
function completeManifestProblem(inputs: AssemblyPlanInputs, shot: Shot, key: string, manifestPath: string, what: string): string | undefined {
  const manifest = inputs.readManifest(manifestPath);
  if (manifest.key !== key) return `${what} at ${manifestPath} was rendered under another key than the job records`;
  if (!isComplete(manifest, shot.durationFrames)) return `${what} at ${manifestPath} is ${manifest.status} with ${manifest.frames.length} of ${shot.durationFrames} frames`;
  return undefined;
}

/**
 * The text plate's frames as the clip's overlay, or null when the job
 * records no plate. The plate renders under its own key (textKey, from the
 * picture's key and the html lane's fingerprint), so it is held to that key
 * when the job records one, to plate 'text' (a picture cache named by
 * mistake would be laid over the picture) and to completeness.
 */
function overlayOf(inputs: AssemblyPlanInputs, shot: Shot, jobShot: JobShot): ClipOverlay | null {
  // A job entry may still carry a plate for a shot that lost its text; still and render clear the fields, and this keeps a stale plate off the clip either way.
  if (!hasTextPlate(shot)) return null;
  const textManifestPath = jobShot.textManifestPath;
  if (textManifestPath === undefined) return null;
  const jobDir = inputs.job.outDir;
  const textManifest = inputs.readManifest(textManifestPath);
  if (jobShot.textKey !== undefined && textManifest.key !== jobShot.textKey) throw new ShotNotRenderedError(shot.id, `its text plate at ${textManifestPath} was rendered under another key than the job records`, jobDir);
  if (textManifest.plate !== 'text') throw new ShotNotRenderedError(shot.id, `the manifest at ${textManifestPath} is not a text plate`, jobDir);
  if (!isComplete(textManifest, shot.durationFrames)) throw new ShotNotRenderedError(shot.id, `its text plate manifest at ${textManifestPath} is ${textManifest.status} with ${textManifest.frames.length} of ${shot.durationFrames} frames`, jobDir);
  return framesSourceBeside(textManifestPath);
}

/** The clip of one shot: its picture plate from the cache and, when the render made one, its text plate as the overlay (null for a shot without one). */
function clipOf(inputs: AssemblyPlanInputs, shot: Shot): Clip {
  const jobShot = findJobShot(inputs.job, shot.id);
  const jobDir = inputs.job.outDir;
  if (jobShot.status !== 'rendered' || jobShot.manifestPath === null) throw new ShotNotRenderedError(shot.id, `its status is ${jobShot.status}`, jobDir);
  const problem = completeManifestProblem(inputs, shot, jobShot.key, jobShot.manifestPath, 'its manifest');
  if (problem !== undefined) throw new ShotNotRenderedError(shot.id, problem, jobDir);
  return { id: shot.id, source: framesSourceBeside(jobShot.manifestPath), durationFrames: shot.durationFrames, overlay: overlayOf(inputs, shot, jobShot) };
}

/** The shot spec's transitions as the plan names them; a cut is the absence of an entry. */
export function planTransitions(shotSpec: ShotSpec): Transition[] {
  return shotSpec.transitions.filter((transition) => transition.type !== 'cut').map((transition) => ({ afterClipId: transition.afterShotId, type: transition.type, frames: transition.frames }));
}

/** The audio mix: the narration as one line from frame 0 (its sentences are already placed inside the WAV), the music ducked under it; absent for a silent piece. */
export function planAudio(narration: NarrationFiles | null, music: MusicInput | null): AudioMix | undefined {
  if (narration === null && music === null) return undefined;
  return {
    narration: narration === null ? [] : [{ path: narration.wavPath, startFrame: 0 }],
    music: music === null ? null : { path: music.path, duckUnderNarration: narration !== null, gainDb: music.gainDb },
    loudnessLufs: deliveryLoudness.lufs,
    truePeakDbtp: deliveryLoudness.truePeakDbtp,
  };
}

/** The smallest caption size the assembly plan schema allows, in pixels. */
export const captionMinimumFontSizePx = 8;

/** The caption style of a look: its body family, its text colour on a 60 percent scrim of its background (typography/system.md, text over picture), 36 px high and 72 px off the bottom at 1080p, scaled with the frame. */
export function captionStyleOf(look: LookBible, height: number): CaptionStyle {
  // 36 px and a 72 px bottom margin at 1080p, scaled with the height; the schema's 8 px floor holds for a fixture-sized frame.
  const scale = height / 1080;
  return { fontFamily: look.typography.body, textColor: look.palette.text, scrimColor: look.palette.background, scrimOpacity: 0.6, fontSizePx: Math.max(captionMinimumFontSizePx, Math.round(36 * scale)), marginBottomPx: Math.round(72 * scale) };
}

/** The captions: the narration's SRT, burnt in only when asked (the brief has no field for it, so the sidecar is the default), set in the look's style. */
export function planCaptions(narration: NarrationFiles | null, burnIn: boolean, look: LookBible, height: number): Captions | undefined {
  return narration === null ? undefined : { srtPath: narration.srtPath, burnIn, style: captionStyleOf(look, height) };
}

/** The finishing grade: the look's vignette and grain with its LUT baked to the given .cube. */
export function planGrade(look: LookBible, cubePath: string): FinishingGrade {
  const { vignetteAmount, vignetteSoftness, grainAmount, grainSeed } = look.grade;
  return { cubePath, vignetteAmount, vignetteSoftness, grainAmount, grainSeed };
}

/** Builds the plan and validates it against its schema and the semantic checks (the transition arithmetic among them). */
export function buildAssemblyPlan(inputs: AssemblyPlanInputs): AssemblyPlan {
  const { shotSpec } = inputs;
  const audio = planAudio(inputs.narration, inputs.music);
  const captions = planCaptions(inputs.narration, inputs.burnIn, inputs.look, shotSpec.height);
  const plan: AssemblyPlan = {
    kind: 'assembly-plan',
    version: 1,
    fps: shotSpec.fps,
    width: shotSpec.width,
    height: shotSpec.height,
    clips: shotSpec.shots.map((shot) => clipOf(inputs, shot)),
    transitions: planTransitions(shotSpec),
    ...(audio === undefined ? {} : { audio }),
    ...(captions === undefined ? {} : { captions }),
    grade: planGrade(inputs.look, inputs.cubePath),
    output: { path: inputs.outputPath, codec: inputs.codec, ...deliveryEncode },
  };
  validateDocument('assembly-plan', plan);
  const problems = runSemanticChecks('assembly-plan', plan, { dataDir: undefined });
  if (problems.length > 0) throw new SchemaValidationError('assembly-plan', problems, 'The plan built from the job breaks the rules in src/schema/checks/assembly-plan.ts; fix the shot spec (plan again) or the --out-file.');
  return plan;
}
