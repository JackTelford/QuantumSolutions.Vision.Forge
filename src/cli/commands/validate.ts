/**
 * `validate <file>`: reads a JSON document, checks it against the schema for
 * its kind (every schema problem in one error) and, once the schema accepts
 * it, runs the kind's semantic checks (every semantic problem in a second
 * error). Either error exits 1; on success the payload names the kind, the
 * absolute path and how many semantic checks ran. The path is absolute or
 * relative to the working directory. The asset-ledger checks read
 * assets.json under the data directory, so every asset id a brief or shot
 * spec names must already be in that ledger: run `assets` first.
 */
import { resolve } from 'node:path';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';
import { SchemaValidationError, UsageError } from '../../errors/vision-forge-error.ts';
import { readJsonFile } from '../../fs/atomic-json.ts';
import { runSemanticChecks, semanticCheckCount } from '../../schema/checks/index.ts';
import { isMissingAssetProblem } from '../../schema/checks/ledger.ts';
import { assertKind, validateDocument } from '../../schema/validator.ts';

/** Shape of the validate payload. */
export interface ValidateData {
  /** The document kind that was validated, for example "shot-spec". */
  readonly kind: string;
  /** Absolute path of the file that was read. */
  readonly path: string;
  /** How many semantic checks ran after the schema accepted the document. */
  readonly checks: number;
}

const usageHint = 'Usage: node scripts/cli.ts validate <file>, where <file> is a JSON document with a "kind" property, absolute or relative to the working directory.';
const ledgerHint = 'Asset ids must already be in the ledger under the data directory: run `assets` first or remove the id.';

/** The hint for semantic problems: where the rules live, plus the ledger when an asset id is missing from it. */
function semanticHint(kind: string, path: string, problems: readonly string[]): string {
  const rules = `Fix the listed problems in ${path}; the rules are in src/schema/checks/${kind}.ts.`;
  return problems.some((problem) => isMissingAssetProblem(problem)) ? `${rules} ${ledgerHint}` : rules;
}

/** The validate command. */
export const command: Command = {
  name: 'validate',
  summary: 'Check a JSON document against its schema and the semantic rules of its kind; asset ids must already be in the ledger under the data directory.',
  options: { strings: [], flags: [] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const file = args.positionals[0];
    if (file === undefined) throw new UsageError('Missing the file to validate.', usageHint);
    if (args.positionals.length > 1) throw new UsageError(`validate takes one file, got ${args.positionals.length}.`, usageHint);
    const path = resolve(context.cwd, file);
    const document = readJsonFile(path);
    const kind = assertKind(document);
    validateDocument(kind, document);
    const problems = runSemanticChecks(kind, document, { dataDir: context.dataDir });
    if (problems.length > 0) throw new SchemaValidationError(kind, problems, semanticHint(kind, path, problems));
    const checks = semanticCheckCount(kind);
    context.log.info(`${path} is a valid ${kind} document; ${checks} semantic check(s) passed.`);
    const data: ValidateData = { kind, path, checks };
    return { data };
  },
};
