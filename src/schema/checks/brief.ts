/**
 * Semantic checks on a brief that its schema cannot express: even
 * dimensions, dimensions that match the declared aspect, a positive
 * duration, a music path present exactly when the policy asks for one, and
 * subject assets that the ledger records. Pure except the ledger lookup.
 */
import type { Aspect, Brief } from '../../shared/contracts/brief.ts';
import { missingAssetIds, missingAssetProblem } from './ledger.ts';
import { isEven, runRules } from './rule.ts';
import type { CheckContext, Rule } from './rule.ts';

/** Width over height for every aspect token. */
export const aspectRatios: Readonly<Record<Aspect, number>> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '21:9': 21 / 9,
};

/** How far the pixel ratio may stray from the aspect, as a fraction of it (1 percent). */
export const aspectTolerance = 0.01;

function evenDimensions(brief: Brief): readonly string[] {
  return isEven(brief.width) && isEven(brief.height) ? [] : [`width and height must be even for yuv420p; got ${brief.width}x${brief.height}`];
}

function dimensionsMatchAspect(brief: Brief): readonly string[] {
  const expected = aspectRatios[brief.aspect];
  const actual = brief.width / brief.height;
  if (Math.abs(actual - expected) <= expected * aspectTolerance) return [];
  return [`width and height ${brief.width}x${brief.height} have ratio ${actual.toFixed(4)}, not within 1 percent of aspect ${brief.aspect} (${expected.toFixed(4)})`];
}

function positiveDuration(brief: Brief): readonly string[] {
  return Number.isFinite(brief.durationSeconds) && brief.durationSeconds > 0 ? [] : [`durationSeconds must be greater than 0; got ${String(brief.durationSeconds)}`];
}

function musicPathMatchesPolicy(brief: Brief): readonly string[] {
  const { policy, path } = brief.music;
  if (policy === 'user-supplied' && path === null) return ['music.path must name the music file when music.policy is user-supplied'];
  if (policy === 'none' && path !== null) return [`music.path must be null when music.policy is none; got ${path}`];
  return [];
}

function subjectAssetsInLedger(brief: Brief, context: CheckContext): readonly string[] {
  return missingAssetIds(context, brief.subject.assetIds).map((missing) => missingAssetProblem('subject.assetIds', missing));
}

/** The brief rules, in the order they run. */
export const briefRules: readonly Rule<Brief>[] = [evenDimensions, dimensionsMatchAspect, positiveDuration, musicPathMatchesPolicy, subjectAssetsInLedger];

/** Problems with the brief, one sentence each; empty when it is sound. */
export function checkBrief(brief: Brief, context: CheckContext): readonly string[] {
  return runRules(briefRules, brief, context);
}
