/**
 * What every semantic check shares: the context a check receives, the shape
 * of one rule and the helpers the per-kind rule lists are built from. A rule
 * takes a document the schema has already accepted and returns problems as
 * sentences; it never throws for a bad document.
 */

/** What a semantic check needs beyond the document. */
export interface CheckContext {
  /** The data directory, when the caller has one; checks that consult the asset ledger need it. */
  readonly dataDir: string | undefined;
}

/** One rule on a document of type T: problems as sentences, empty when the rule holds. */
export type Rule<T> = (document: T, context: CheckContext) => readonly string[];

/** Runs every rule over the document and concatenates the problems in rule order. */
export function runRules<T>(rules: readonly Rule<T>[], document: T, context: CheckContext): readonly string[] {
  return rules.flatMap((rule) => rule(document, context));
}

/** The ids that occur more than once, each reported once, in the order they first repeat. */
export function duplicateIds(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const id of ids) {
    if (seen.has(id) && !repeated.includes(id)) repeated.push(id);
    seen.add(id);
  }
  return repeated;
}

/** True when a pixel count can be encoded as yuv420p: even. */
export function isEven(value: number): boolean {
  return value % 2 === 0;
}
