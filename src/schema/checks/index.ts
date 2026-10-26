/**
 * Semantic checks per document kind, run by `validate` after the schema has
 * accepted a document. A kind without an entry has no checks beyond its
 * schema. Each check takes a document the schema has already validated and
 * returns problems as sentences; it never throws for a bad document.
 */
import type { AssemblyPlan } from '../../shared/contracts/assembly-plan.ts';
import { checkAssemblyPlan } from './assembly-plan.ts';

/** What a semantic check needs beyond the document. */
export interface CheckContext {
  /** The data directory, when the caller has one; checks that consult the asset ledger need it. */
  readonly dataDir: string | undefined;
}

/** A semantic check for one document kind. */
export type SemanticCheck = (document: unknown, context: CheckContext) => readonly string[];

/** The checks, keyed by document kind. */
export const semanticChecks: Readonly<Record<string, SemanticCheck>> = {
  'assembly-plan': (document: unknown): readonly string[] => checkAssemblyPlan(document as AssemblyPlan),
};

/** Runs the semantic check for a kind; a kind without one returns no problems. */
export function runSemanticChecks(kind: string, document: unknown, context: CheckContext): readonly string[] {
  const check = semanticChecks[kind];
  return check === undefined ? [] : check(document, context);
}
