/**
 * The one error the plan command raises beyond the shared ones: the four
 * documents are each valid on their own but do not agree with each other.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';

/** The brief, treatment, shot spec and look bible contradict each other (ids, frame, beats, transitions or length). */
export class CrossDocumentError extends VisionForgeError {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super({
      code: 'cross-document',
      // Every problem, not the first three: a shot list with twenty faults is fixed in one pass only when all twenty are named (the field test of 2026-10-30 hid 21).
      message: `The four documents do not agree (${problems.length} problem${problems.length === 1 ? '' : 's'}): ${problems.join('; ')}.`,
      hint: 'Fix the listed problems in the documents; the rules are in src/plan/cross-checks.ts and skills/cinematic-studio/references/editing/pacing-and-transitions.md.',
    });
    this.problems = problems;
  }
}
