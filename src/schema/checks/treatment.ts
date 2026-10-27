/**
 * Semantic checks on a treatment that its schema cannot express: beat ids
 * are unique, every shot id belongs to exactly one beat and every beat is
 * made of at least one shot. Pure.
 */
import type { Treatment } from '../../shared/contracts/treatment.ts';
import { duplicateIds, runRules } from './rule.ts';
import type { CheckContext, Rule } from './rule.ts';

function uniqueBeatIds(treatment: Treatment): readonly string[] {
  return duplicateIds(treatment.beats.map((beat) => beat.id)).map((id) => `beat id "${id}" is used more than once`);
}

function uniqueShotIdsAcrossBeats(treatment: Treatment): readonly string[] {
  return duplicateIds(treatment.beats.flatMap((beat) => beat.shotIds)).map((id) => `shot id "${id}" appears in more than one beat`);
}

function beatsHaveShots(treatment: Treatment): readonly string[] {
  return treatment.beats.filter((beat) => beat.shotIds.length === 0).map((beat) => `beat "${beat.id}" has no shots`);
}

/** The treatment rules, in the order they run. */
export const treatmentRules: readonly Rule<Treatment>[] = [uniqueBeatIds, uniqueShotIdsAcrossBeats, beatsHaveShots];

/** Problems with the treatment, one sentence each; empty when it is sound. */
export function checkTreatment(treatment: Treatment, context: CheckContext): readonly string[] {
  return runRules(treatmentRules, treatment, context);
}
