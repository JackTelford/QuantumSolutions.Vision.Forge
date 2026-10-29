/**
 * Checks across the four approved documents that no single document's
 * schema or semantic rules can express: the ids refer to each other, the
 * frame and rate agree, the treatment's beats and the shot spec's shots are
 * the same list in the same order, the transition grammar of
 * skills/cinematic-studio/references/editing/pacing-and-transitions.md
 * holds, and the piece is as long as the brief asked. Problems fail the
 * plan; warnings are logged and the plan goes ahead. Pure: no file system.
 */
import { totalFrames } from '../schema/checks/shot-spec.ts';
import type { Brief } from '../shared/contracts/brief.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { Shot, ShotSpec, Transition } from '../shared/contracts/shot-spec.ts';
import type { Beat, Treatment } from '../shared/contracts/treatment.ts';

/** The four approved documents a plan is built from. */
export interface PlanDocuments {
  readonly brief: Brief;
  readonly treatment: Treatment;
  readonly shotSpec: ShotSpec;
  readonly look: LookBible;
}

/** How far the piece may stray from the brief's length, and a beat from its own, in seconds. */
export const durationToleranceSeconds = 0.5;

/** Shots shorter than this many seconds may not carry two non-cut transitions in a row (pacing rule 2). */
export const shortShotSeconds = 2;

/** The transition after a shot: the explicit entry, or a cut with 0 frames when the spec lists none (the schema's default join; a cut's frames are ignored anyway). */
export function transitionAfter(spec: ShotSpec, shotId: string): Transition {
  return spec.transitions.find((transition) => transition.afterShotId === shotId) ?? { afterShotId: shotId, type: 'cut', frames: 0 };
}

/**
 * The delivery frame at which each shot starts, in spec order: each shot
 * begins where the previous one ended minus the overlap of a non-cut
 * transition between them, the same arithmetic as the assembly plan's
 * clipStartFrames. Frames are integers counted from 0.
 */
export function shotStartFrames(spec: ShotSpec): readonly number[] {
  const starts: number[] = [];
  let position = 0;
  for (const shot of spec.shots) {
    starts.push(position);
    const transition = transitionAfter(spec, shot.id);
    position += shot.durationFrames - (transition.type === 'cut' ? 0 : transition.frames);
  }
  return starts;
}

/** The seconds a count of frames covers at the spec's rate, with one decimal, for messages. */
function seconds(frames: number, fps: number): string {
  return `${(frames / fps).toFixed(1)} s`;
}

function idsAgree({ brief, treatment, shotSpec, look }: PlanDocuments): readonly string[] {
  const problems: string[] = [];
  if (treatment.briefId !== brief.id) problems.push(`treatment "${treatment.id}" answers brief "${treatment.briefId}", not the brief "${brief.id}" given`);
  if (shotSpec.briefId !== brief.id) problems.push(`shot spec "${shotSpec.id}" serves brief "${shotSpec.briefId}", not the brief "${brief.id}" given`);
  if (shotSpec.treatmentId !== treatment.id) problems.push(`shot spec "${shotSpec.id}" comes from treatment "${shotSpec.treatmentId}", not the treatment "${treatment.id}" given`);
  if (shotSpec.lookId !== look.id) problems.push(`shot spec "${shotSpec.id}" uses look "${shotSpec.lookId}", not the look bible "${look.id}" given`);
  if (treatment.lookId !== look.id) problems.push(`treatment "${treatment.id}" uses look "${treatment.lookId}", not the look bible "${look.id}" given`);
  return problems;
}

function frameAgrees({ brief, shotSpec }: PlanDocuments): readonly string[] {
  const problems: string[] = [];
  if (shotSpec.fps !== brief.fps) problems.push(`shot spec fps ${shotSpec.fps} differs from the brief's ${brief.fps}`);
  if (shotSpec.width !== brief.width || shotSpec.height !== brief.height) problems.push(`shot spec frame ${shotSpec.width}x${shotSpec.height} differs from the brief's ${brief.width}x${brief.height}`);
  return problems;
}

/** Every beat names shots of the spec, every shot sits in exactly one beat, and the beats list the shots in spec order. */
function beatsMatchShots({ treatment, shotSpec }: PlanDocuments): readonly string[] {
  const problems: string[] = [];
  const specIds = shotSpec.shots.map((shot) => shot.id);
  const beatOf = new Map<string, Beat[]>();
  for (const beat of treatment.beats) {
    for (const shotId of beat.shotIds) {
      if (!specIds.includes(shotId)) problems.push(`beat "${beat.id}" names shot "${shotId}", which the shot spec does not have`);
      beatOf.set(shotId, [...(beatOf.get(shotId) ?? []), beat]);
    }
  }
  for (const shotId of specIds) {
    const beats = beatOf.get(shotId) ?? [];
    if (beats.length === 0) problems.push(`shot "${shotId}" belongs to no beat of the treatment`);
    if (beats.length > 1) problems.push(`shot "${shotId}" belongs to ${beats.length} beats (${beats.map((beat) => `"${beat.id}"`).join(', ')}), not exactly one`);
  }
  if (problems.length > 0) return problems;
  const beatOrder = treatment.beats.flatMap((beat) => beat.shotIds);
  if (beatOrder.some((shotId, index) => shotId !== specIds[index])) {
    problems.push(`the beats list the shots as ${beatOrder.join(', ')}, but the shot spec orders them ${specIds.join(', ')}`);
  }
  return problems;
}

/** Each transition follows a shot that is not the last and is no longer than either neighbour (pacing rule 1). */
function transitionsFitNeighbours({ shotSpec }: PlanDocuments): readonly string[] {
  const problems: string[] = [];
  for (const transition of shotSpec.transitions) {
    const index = shotSpec.shots.findIndex((shot) => shot.id === transition.afterShotId);
    const before = shotSpec.shots[index];
    const after = shotSpec.shots[index + 1];
    if (before === undefined) {
      problems.push(`transition after "${transition.afterShotId}" names a shot that does not exist`);
    } else if (after === undefined) {
      problems.push(`transition after "${transition.afterShotId}" follows the last shot; a transition needs a shot on each side`);
    } else if (transition.type !== 'cut' && transition.frames > Math.min(before.durationFrames, after.durationFrames)) {
      problems.push(`${transition.type} after "${before.id}" is ${transition.frames} frames, longer than "${before.id}" (${before.durationFrames}) or "${after.id}" (${after.durationFrames}); a transition is no longer than either neighbour`);
    }
  }
  return problems;
}

/** True when the shot is shorter than the pacing grammar's short-shot limit at the spec's rate. */
function isShortShot(shot: Shot, fps: number): boolean {
  return shot.durationFrames < shortShotSeconds * fps;
}

/**
 * Pacing rule 2: two non-cut transitions in a row (after shot i and after
 * shot i + 1) are not allowed when any of the three shots they touch (i,
 * i + 1 and i + 2) is shorter than 2 s; the middle shot would be mostly
 * overlap, and a short outer shot would be mostly transition. The rule is
 * symmetric: the second transition sits on shot i + 2 just as the first
 * sits on shot i.
 */
function noDoubleTransitionOnShortShots({ shotSpec }: PlanDocuments): readonly string[] {
  const problems: string[] = [];
  for (let index = 0; index + 2 < shotSpec.shots.length; index += 1) {
    const first = shotSpec.shots[index];
    const second = shotSpec.shots[index + 1];
    const third = shotSpec.shots[index + 2];
    if (first === undefined || second === undefined || third === undefined) continue;
    const firstTransition = transitionAfter(shotSpec, first.id);
    const secondTransition = transitionAfter(shotSpec, second.id);
    if (firstTransition.type === 'cut' || secondTransition.type === 'cut') continue;
    const shortShots = [first, second, third].filter((shot) => isShortShot(shot, shotSpec.fps));
    if (shortShots.length === 0) continue;
    const short = shortShots.map((shot) => `"${shot.id}" (${seconds(shot.durationFrames, shotSpec.fps)})`).join(' and ');
    problems.push(`${firstTransition.type} after "${first.id}" and ${secondTransition.type} after "${second.id}" are two non-cut transitions in a row on shots under ${shortShotSeconds} s: ${short}`);
  }
  return problems;
}

/** The delivery (shots minus non-cut overlaps) is within half a second of the brief's length. */
function totalMatchesBrief({ brief, shotSpec }: PlanDocuments): readonly string[] {
  const actual = totalFrames(shotSpec);
  const target = brief.durationSeconds * shotSpec.fps;
  const toleranceFrames = durationToleranceSeconds * shotSpec.fps;
  if (Math.abs(actual - target) <= toleranceFrames) return [];
  return [`the shots total ${actual} frames (${seconds(actual, shotSpec.fps)}) after transitions, but the brief asks for ${brief.durationSeconds} s (${target} frames); the difference is more than ${durationToleranceSeconds} s`];
}

/** One cross-document rule: problems or warnings as sentences, empty when it holds. */
export type CrossRule = (documents: PlanDocuments) => readonly string[];

/** The rules whose findings fail the plan, in the order they run. */
export const crossProblemRules: readonly CrossRule[] = [
  idsAgree,
  frameAgrees,
  beatsMatchShots,
  transitionsFitNeighbours,
  noDoubleTransitionOnShortShots,
  totalMatchesBrief,
];

/** Problems between the four documents, one sentence each; empty when they agree. */
export function crossDocumentProblems(brief: Brief, treatment: Treatment, shotSpec: ShotSpec, look: LookBible): readonly string[] {
  const documents: PlanDocuments = { brief, treatment, shotSpec, look };
  return crossProblemRules.flatMap((rule) => rule(documents));
}

/** A beat whose shots (their frames summed, before transitions) are more than half a second away from its own length. */
function beatsMatchTheirLength({ treatment, shotSpec }: PlanDocuments): readonly string[] {
  const warnings: string[] = [];
  const toleranceFrames = durationToleranceSeconds * shotSpec.fps;
  for (const beat of treatment.beats) {
    const frames = beat.shotIds.reduce((sum, shotId) => sum + (shotSpec.shots.find((shot) => shot.id === shotId)?.durationFrames ?? 0), 0);
    const target = beat.durationSeconds * shotSpec.fps;
    if (Math.abs(frames - target) > toleranceFrames) warnings.push(`beat "${beat.id}" is planned at ${beat.durationSeconds} s but its shots sum to ${frames} frames (${seconds(frames, shotSpec.fps)})`);
  }
  return warnings;
}

/** True when the shot holds: no camera travel, or the breathing drift the end card uses. */
function isHold(shot: Shot): boolean {
  return shot.move.preset === 'static-hold' || shot.move.preset === 'breathe';
}

/** True when the last join of the piece, the transition into the last shot, is a fade to black; the spec has no field for a fade after the last shot. */
function endsOnFadeBlack(spec: ShotSpec): boolean {
  const secondToLast = spec.shots[spec.shots.length - 2];
  return secondToLast !== undefined && transitionAfter(spec, secondToLast.id).type === 'fade-black';
}

/** Pacing rule 3 for a product film: at most one dissolve, and an ending on a fade-black or a hold. */
function productFilmEnding({ brief, shotSpec }: PlanDocuments): readonly string[] {
  if (brief.useCase !== 'product-shot') return [];
  const warnings: string[] = [];
  const dissolves = shotSpec.transitions.filter((transition) => transition.type === 'dissolve').length;
  if (dissolves > 1) warnings.push(`a product film has at most one dissolve; this one has ${dissolves}`);
  const last = shotSpec.shots[shotSpec.shots.length - 1];
  if (last !== undefined && !isHold(last) && !endsOnFadeBlack(shotSpec)) warnings.push(`a product film ends on a fade-black or a hold; the last shot "${last.id}" moves with ${last.move.preset} and no fade-black leads into it`);
  return warnings;
}

/** Pacing rule 3 for a title sequence: it ends on a fade-black. */
function titleSequenceEnding({ brief, shotSpec }: PlanDocuments): readonly string[] {
  if (brief.useCase !== 'title-sequence' || endsOnFadeBlack(shotSpec)) return [];
  return ['a title sequence ends on a fade-black; no fade-black leads into the last shot'];
}

/** Pacing rule 4: a change of lighting rig between two shots is crossed only by a fade-black (the reference names no other join), never by a cut, a dissolve, a fade-white, a wipe or a slide. */
function lightingChangesBehindFades({ shotSpec }: PlanDocuments): readonly string[] {
  const warnings: string[] = [];
  for (let index = 0; index + 1 < shotSpec.shots.length; index += 1) {
    const before = shotSpec.shots[index];
    const after = shotSpec.shots[index + 1];
    if (before === undefined || after === undefined || before.lighting.preset === after.lighting.preset) continue;
    const transition = transitionAfter(shotSpec, before.id);
    if (transition.type === 'fade-black') continue;
    warnings.push(`the ${transition.type} after "${before.id}" crosses a change of lighting rig (${before.lighting.preset} to ${after.lighting.preset}); only a fade-black hides a rig change`);
  }
  return warnings;
}

/** A treatment that lets narration set the clock while the brief has narration off. */
function narrationFirstNeedsNarration({ brief, treatment }: PlanDocuments): readonly string[] {
  return treatment.narrationFirst && !brief.narration.enabled ? ['the treatment sets narrationFirst, but the brief has narration disabled; shot durations will not follow a voice'] : [];
}

/** The rules whose findings are logged as warnings, in the order they run. */
export const crossWarningRules: readonly CrossRule[] = [
  beatsMatchTheirLength,
  productFilmEnding,
  titleSequenceEnding,
  lightingChangesBehindFades,
  narrationFirstNeedsNarration,
];

/** Warnings about the four documents, one sentence each; they do not stop the plan. */
export function crossDocumentWarnings(brief: Brief, treatment: Treatment, shotSpec: ShotSpec, look: LookBible): readonly string[] {
  const documents: PlanDocuments = { brief, treatment, shotSpec, look };
  return crossWarningRules.flatMap((rule) => rule(documents));
}
