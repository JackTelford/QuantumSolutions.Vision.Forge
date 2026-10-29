/**
 * Reading the four approved documents for the plan command: each file is
 * read, its kind compared with the option that named it, checked against its
 * schema and then its semantic rules. Every problem of every document is
 * collected so one run reports everything, then thrown as one error whose
 * problems are prefixed with the document kind.
 */
import { SchemaValidationError } from '../errors/vision-forge-error.ts';
import { readJsonFile } from '../fs/atomic-json.ts';
import { runSemanticChecks } from '../schema/checks/index.ts';
import { assertKind, validateDocument } from '../schema/validator.ts';
import type { Brief } from '../shared/contracts/brief.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { ShotSpec } from '../shared/contracts/shot-spec.ts';
import type { Treatment } from '../shared/contracts/treatment.ts';
import type { PlanDocuments } from './cross-checks.ts';

/** The command-line option that names each document, with the kind the file must have. */
export const documentOptions = [
  { option: 'brief', kind: 'brief' },
  { option: 'treatment', kind: 'treatment' },
  { option: 'shot-spec', kind: 'shot-spec' },
  { option: 'look', kind: 'look-bible' },
] as const;

/** One of the four option names. */
export type DocumentOption = (typeof documentOptions)[number]['option'];

/** The absolute path of each document file, keyed by its option. */
export type DocumentPaths = Readonly<Record<DocumentOption, string>>;

/** What validating one file produced: the document when it is sound, or the problems with it. */
export interface DocumentCheck {
  readonly kind: string;
  readonly document: unknown;
  readonly problems: readonly string[];
}

/** The schema problems of a document, as the validator lists them; empty when the schema accepts it. */
function schemaProblems(kind: string, document: unknown): readonly string[] {
  try {
    validateDocument(kind, document);
    return [];
  } catch (error: unknown) {
    if (error instanceof SchemaValidationError) return error.problems;
    throw error;
  }
}

/**
 * Reads one file and checks it: the kind named by the option (a missing or
 * unknown kind is collected as a problem naming the option and the file, like
 * a wrong kind), then the schema, then (only once the schema accepts it,
 * since the rules assume its shape) the semantic rules with the data
 * directory for the asset ledger.
 */
export function checkDocument(option: DocumentOption, expectedKind: string, path: string, dataDir: string): DocumentCheck {
  const document = readJsonFile(path);
  let kind: string;
  try {
    kind = assertKind(document);
  } catch (error: unknown) {
    if (!(error instanceof SchemaValidationError)) throw error;
    return { kind: expectedKind, document, problems: error.problems.map((problem) => `--${option} (${path}): ${problem}`) };
  }
  if (kind !== expectedKind) return { kind: expectedKind, document, problems: [`--${option} names a ${kind} document (${path}), not a ${expectedKind}`] };
  const schema = schemaProblems(kind, document);
  if (schema.length > 0) return { kind, document, problems: schema };
  return { kind, document, problems: runSemanticChecks(kind, document, { dataDir }) };
}

/** Reads and checks the four documents; throws one SchemaValidationError listing every problem of every document, each prefixed with its kind. */
export function loadPlanDocuments(paths: DocumentPaths, dataDir: string): PlanDocuments {
  const checks = documentOptions.map((entry) => ({ ...entry, check: checkDocument(entry.option, entry.kind, paths[entry.option], dataDir) }));
  const failing = checks.filter((entry) => entry.check.problems.length > 0);
  if (failing.length > 0) {
    const problems = failing.flatMap((entry) => entry.check.problems.map((problem) => `${entry.kind}: ${problem}`));
    const kinds = failing.map((entry) => entry.kind).join(' and ');
    const files = failing.map((entry) => `${entry.kind} at ${paths[entry.option]}`).join(', ');
    throw new SchemaValidationError(kinds, problems, `Fix the listed problems (${files}); run validate <file> on each document to see its rules, which live in schemas/ and src/schema/checks/.`);
  }
  const [brief, treatment, shotSpec, look] = checks.map((entry) => entry.check.document);
  return { brief: brief as Brief, treatment: treatment as Treatment, shotSpec: shotSpec as ShotSpec, look: look as LookBible };
}
