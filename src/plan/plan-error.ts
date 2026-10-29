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
      message: `The four documents do not agree: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ''}.`,
      hint: 'Fix the listed problems in the documents; the rules are in src/plan/cross-checks.ts and skills/cinematic-studio/references/editing/pacing-and-transitions.md.',
    });
    this.problems = problems;
  }
}
