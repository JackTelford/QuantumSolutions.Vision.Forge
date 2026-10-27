/**
 * Semantic checks on a shot spec that its schema cannot express: even
 * dimensions, unique shot and text ids, move and text frames inside the
 * shot, text boxes inside the title-safe area, transitions that name real
 * neighbours and fit inside them, a positive total length, and subject
 * assets that the ledger records. Pure except the ledger lookup.
 */
import type { Shot, ShotSpec, ShotSubject, TextElement, Transition } from '../../shared/contracts/shot-spec.ts';
import { missingAssetIds, missingAssetProblem } from './ledger.ts';
import { duplicateIds, isEven, runRules } from './rule.ts';
import type { CheckContext, Rule } from './rule.ts';

/** The title-safe area: text boxes stay inside the central 90 percent of the frame, so this far from every edge. */
export const titleSafeMargin = 0.05;

/** Slack for sums of fractions such as 0.05 + 0.9, which floating point puts a hair above 0.95. */
const fractionEpsilon = 1e-9;

/** The piece's length in frames: the shots minus every transition overlap. */
export function totalFrames(spec: ShotSpec): number {
  const shotFrames = spec.shots.reduce((sum, shot) => sum + shot.durationFrames, 0);
  const overlap = spec.transitions.filter((t) => t.type !== 'cut').reduce((sum, t) => sum + t.frames, 0);
  return shotFrames - overlap;
}

function evenDimensions(spec: ShotSpec): readonly string[] {
  return isEven(spec.width) && isEven(spec.height) ? [] : [`width and height must be even for yuv420p; got ${spec.width}x${spec.height}`];
}

function uniqueShotIds(spec: ShotSpec): readonly string[] {
  return duplicateIds(spec.shots.map((shot) => shot.id)).map((id) => `shot id "${id}" is used more than once`);
}

function uniqueTextIdsPerShot(spec: ShotSpec): readonly string[] {
  return spec.shots.flatMap((shot) => duplicateIds(shot.text.map((text) => text.id)).map((id) => `shot "${shot.id}" uses text id "${id}" more than once`));
}

function moveWithinShot(spec: ShotSpec): readonly string[] {
  const problems: string[] = [];
  for (const shot of spec.shots) {
    const { startFrame, endFrame } = shot.move;
    if (startFrame >= shot.durationFrames) problems.push(`shot "${shot.id}" starts its move at frame ${startFrame}, at or after its ${shot.durationFrames} frames`);
    if (endFrame === null) continue;
    if (endFrame <= startFrame) problems.push(`shot "${shot.id}" ends its move at frame ${endFrame}, not after its start frame ${startFrame}`);
    if (endFrame > shot.durationFrames) problems.push(`shot "${shot.id}" ends its move at frame ${endFrame}, after its ${shot.durationFrames} frames`);
  }
  return problems;
}

function textFramesWithinShot(shot: Shot, text: TextElement): readonly string[] {
  const problems: string[] = [];
  if (text.inFrame >= shot.durationFrames) problems.push(`text "${text.id}" of shot "${shot.id}" enters at frame ${text.inFrame}, at or after the shot's ${shot.durationFrames} frames`);
  if (text.outFrame !== null) {
    if (text.outFrame <= text.inFrame) problems.push(`text "${text.id}" of shot "${shot.id}" leaves at frame ${text.outFrame}, not after it enters at frame ${text.inFrame}`);
    if (text.outFrame > shot.durationFrames) problems.push(`text "${text.id}" of shot "${shot.id}" leaves at frame ${text.outFrame}, after the shot's ${shot.durationFrames} frames`);
  }
  return problems;
}

function textWithinShot(spec: ShotSpec): readonly string[] {
  return spec.shots.flatMap((shot) => shot.text.flatMap((text) => textFramesWithinShot(shot, text)));
}

function textInsideTitleSafeArea(spec: ShotSpec): readonly string[] {
  const problems: string[] = [];
  const low = titleSafeMargin - fractionEpsilon;
  const high = 1 - titleSafeMargin + fractionEpsilon;
  for (const shot of spec.shots) {
    for (const text of shot.text) {
      const { x, y, w, h } = text.box;
      if (x < low || y < low || x + w > high || y + h > high) {
        problems.push(`text "${text.id}" of shot "${shot.id}" has box x ${x} y ${y} w ${w} h ${h}, outside the title-safe area (${titleSafeMargin} to ${1 - titleSafeMargin} of the frame)`);
      }
    }
  }
  return problems;
}

function transitionProblems(spec: ShotSpec, transition: Transition, seen: Set<string>): readonly string[] {
  const index = spec.shots.findIndex((shot) => shot.id === transition.afterShotId);
  if (index < 0) return [`transition after "${transition.afterShotId}" names a shot that does not exist`];
  const problems: string[] = [];
  if (index === spec.shots.length - 1) problems.push(`transition after "${transition.afterShotId}" follows the last shot`);
  if (seen.has(transition.afterShotId)) problems.push(`shot "${transition.afterShotId}" has more than one transition after it`);
  seen.add(transition.afterShotId);
  const before = spec.shots[index];
  const after = spec.shots[index + 1];
  if (transition.type !== 'cut' && before !== undefined && after !== undefined && transition.frames > Math.min(before.durationFrames, after.durationFrames)) {
    problems.push(`transition after "${transition.afterShotId}" is ${transition.frames} frames, longer than one of its shots`);
  }
  return problems;
}

function transitionsFit(spec: ShotSpec): readonly string[] {
  const seen = new Set<string>();
  return spec.transitions.flatMap((transition) => transitionProblems(spec, transition, seen));
}

function positiveTotalLength(spec: ShotSpec): readonly string[] {
  if (spec.shots.length === 0) return ['the spec has no shots'];
  return totalFrames(spec) > 0 ? [] : ['the transitions remove every frame; the piece would be empty'];
}

/** A shot whose subject is a ledger asset rather than a primitive. */
type AssetBackedShot = Shot & { readonly subject: ShotSubject & { readonly assetId: string } };

function hasAssetSubject(shot: Shot): shot is AssetBackedShot {
  return shot.subject.assetId !== null;
}

/** Collects every asset id first so the ledger is read once, then reports each shot whose asset it lacks, in shot order. */
function subjectAssetsInLedger(spec: ShotSpec, context: CheckContext): readonly string[] {
  const named = spec.shots.filter(hasAssetSubject);
  const missing = new Map(missingAssetIds(context, named.map((shot) => shot.subject.assetId)).map((entry) => [entry.id, entry]));
  return named.flatMap((shot) => {
    const entry = missing.get(shot.subject.assetId);
    return entry === undefined ? [] : [missingAssetProblem(`shot "${shot.id}" subject`, entry)];
  });
}

/** The shot-spec rules, in the order they run. */
export const shotSpecRules: readonly Rule<ShotSpec>[] = [
  evenDimensions,
  uniqueShotIds,
  uniqueTextIdsPerShot,
  moveWithinShot,
  textWithinShot,
  textInsideTitleSafeArea,
  transitionsFit,
  positiveTotalLength,
  subjectAssetsInLedger,
];

/** Problems with the shot spec, one sentence each; empty when it is sound. */
export function checkShotSpec(spec: ShotSpec, context: CheckContext): readonly string[] {
  return runRules(shotSpecRules, spec, context);
}
