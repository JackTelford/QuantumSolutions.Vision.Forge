/**
 * Semantic checks on a look bible that its schema cannot express: text
 * reaches WCAG contrast over the background and over surfaces, the QA
 * exposure band is a band, and the type scale ratio is one of the two the
 * type system supports. Pure.
 */
import { bodyTextMinimumContrast, contrastRatio } from '../../shared/color/contrast.ts';
import type { LookBible } from '../../shared/contracts/look-bible.ts';
import { runRules } from './rule.ts';
import type { CheckContext, Rule } from './rule.ts';

/** The WCAG 2.2 AA contrast ratio palette text must reach over what it sits on: the body-text minimum from src/shared/color/contrast.ts. */
export const minimumTextContrast: number = bodyTextMinimumContrast;

/** The type scale ratios the type system supports: a major third and a perfect fourth. */
export const typeScaleRatios: readonly number[] = [1.25, 1.333];

function contrastProblem(look: LookBible, over: 'background' | 'surface'): readonly string[] {
  const ratio = contrastRatio(look.palette.text, look.palette[over]);
  if (ratio >= minimumTextContrast) return [];
  return [`palette.text ${look.palette.text} over palette.${over} ${look.palette[over]} has contrast ${ratio.toFixed(2)}, below the WCAG minimum of ${minimumTextContrast}`];
}

function textContrastOverBackground(look: LookBible): readonly string[] {
  return contrastProblem(look, 'background');
}

function textContrastOverSurface(look: LookBible): readonly string[] {
  return contrastProblem(look, 'surface');
}

function exposureBand(look: LookBible): readonly string[] {
  return look.qa.yavgMin < look.qa.yavgMax ? [] : [`qa.yavgMin ${look.qa.yavgMin} must be below qa.yavgMax ${look.qa.yavgMax}`];
}

function supportedScaleRatio(look: LookBible): readonly string[] {
  const ratio = look.typography.scaleRatio;
  return typeScaleRatios.includes(ratio) ? [] : [`typography.scaleRatio must be ${typeScaleRatios.join(' or ')}; got ${ratio}`];
}

/** The look-bible rules, in the order they run. */
export const lookBibleRules: readonly Rule<LookBible>[] = [textContrastOverBackground, textContrastOverSurface, exposureBand, supportedScaleRatio];

/** Problems with the look bible, one sentence each; empty when it is sound. */
export function checkLookBible(look: LookBible, context: CheckContext): readonly string[] {
  return runRules(lookBibleRules, look, context);
}
