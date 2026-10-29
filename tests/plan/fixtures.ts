/**
 * A quartet of documents that agree with each other, built from the valid
 * examples under tests/schema/documents/: the brief asks 10 s at 30 fps, the
 * shots total 105 + 90 + 120 frames minus a 15-frame dissolve = 300 frames,
 * beat b1 is 6.5 s (195 frames) and b2 4 s (120 frames), the last shot
 * holds, so the cross checks report no problem and no warning. Not a test
 * file: the test runner never loads it on its own.
 */
import type { PlanDocuments } from '../../src/plan/cross-checks.ts';
import type { Brief } from '../../src/shared/contracts/brief.ts';
import type { LookBible } from '../../src/shared/contracts/look-bible.ts';
import type { ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import type { Treatment } from '../../src/shared/contracts/treatment.ts';
import { briefExample, lookBibleExample, mutated, shotSpecExample, treatmentExample } from '../schema/documents/examples.ts';

/** The product-shot brief: 10 s, 1080p30. */
export const planBrief: Brief = briefExample;

/** The two-beat treatment, its first beat lengthened to the 195 frames its shots sum to. */
export const planTreatment: Treatment = mutated(treatmentExample, (copy) => {
  const reveal = copy.beats[0];
  if (reveal !== undefined) reveal.durationSeconds = 6.5;
});

/** The three shots, the first lengthened to 105 frames so the dissolve leaves exactly 300, the last holding still for the end card. */
export const planShotSpec: ShotSpec = mutated(shotSpecExample, (copy) => {
  const first = copy.shots[0];
  if (first !== undefined) first.durationFrames = 105;
  const last = copy.shots[2];
  if (last !== undefined) last.move = { preset: 'static-hold', amplitude: 0, easing: 'linear', startFrame: 0, endFrame: null };
});

/** The obsidian look. */
export const planLook: LookBible = lookBibleExample;

/** Deep copies of the quartet, so a test may mutate them freely. */
export function planDocuments(): PlanDocuments {
  return structuredClone({ brief: planBrief, treatment: planTreatment, shotSpec: planShotSpec, look: planLook });
}

/** The quartet with one change applied, for failing examples. */
export function planDocumentsWith(change: (documents: PlanDocuments) => void): PlanDocuments {
  const documents = planDocuments();
  change(documents);
  return documents;
}
