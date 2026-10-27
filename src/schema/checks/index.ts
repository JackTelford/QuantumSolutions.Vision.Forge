/**
 * Semantic checks per document kind, run by `validate` after the schema has
 * accepted a document. A kind without an entry has no checks beyond its
 * schema. Each check takes a document the schema has already validated and
 * returns problems as sentences; it never throws for a bad document. The
 * only impure check is the asset-ledger lookup, which runs when the context
 * carries a data directory.
 */
import type { AssemblyPlan } from '../../shared/contracts/assembly-plan.ts';
import { checkAssemblyPlan } from './assembly-plan.ts';
import { assetsLedgerRules } from './assets-ledger.ts';
import { briefRules } from './brief.ts';
import { jobRules } from './job.ts';
import { lookBibleRules } from './look-bible.ts';
import type { CheckContext, Rule } from './rule.ts';
import { shotSpecRules } from './shot-spec.ts';
import { treatmentRules } from './treatment.ts';

export type { CheckContext, Rule } from './rule.ts';

/** A semantic check for one document kind. */
export type SemanticCheck = (document: unknown, context: CheckContext) => readonly string[];

/** Adapts a rule on a typed document to a check on the unknown document the schema accepted. */
function typed<T>(rule: Rule<T>): SemanticCheck {
  return (document: unknown, context: CheckContext): readonly string[] => rule(document as T, context);
}

/** The checks, keyed by document kind, in the order they run for that kind. */
export const semanticChecks: Readonly<Record<string, readonly SemanticCheck[]>> = {
  'assembly-plan': [typed((plan: AssemblyPlan): readonly string[] => checkAssemblyPlan(plan))],
  'assets-ledger': assetsLedgerRules.map((rule) => typed(rule)),
  brief: briefRules.map((rule) => typed(rule)),
  treatment: treatmentRules.map((rule) => typed(rule)),
  'shot-spec': shotSpecRules.map((rule) => typed(rule)),
  'look-bible': lookBibleRules.map((rule) => typed(rule)),
  job: jobRules.map((rule) => typed(rule)),
};

/** How many semantic checks a kind has; 0 for a kind with none beyond its schema. */
export function semanticCheckCount(kind: string): number {
  return semanticChecks[kind]?.length ?? 0;
}

/** Runs the semantic checks for a kind in order and concatenates their problems; a kind without checks returns none. */
export function runSemanticChecks(kind: string, document: unknown, context: CheckContext): readonly string[] {
  return (semanticChecks[kind] ?? []).flatMap((check) => check(document, context));
}
