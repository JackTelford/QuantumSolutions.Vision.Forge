/**
 * The house-rule lint: `node scripts/lint.ts [--json] [--root <dir>] [paths...]`.
 *
 * Lints every .ts file under src/, scripts/ and tests/ (never tests/fixtures/)
 * against the rules in src/lint/. Each finding is one line on standard error,
 * `path:line:col rule message`, followed by a one-line summary; with --json
 * the findings go to standard output as a JSON array instead. Positional
 * paths (files or directories) restrict the run. --root names the directory
 * that paths are reported relative to and that the path-based rules key on;
 * it defaults to the repository root. Exit codes: 0 clean, 1 findings, 2 usage.
 */
import { resolve } from 'node:path';
import { parseArguments } from '../src/cli/arguments.ts';
import { ExitCodes, describeError } from '../src/errors/vision-forge-error.ts';
import { discoverFiles, expandPaths, formatFinding, formatSummary, lintFiles } from '../src/lint/runner.ts';

function main(): number {
  const args = parseArguments(process.argv.slice(2), { strings: ['root'], flags: ['json'] });
  const root = resolve(args.string('root') ?? resolve(import.meta.dirname, '..'));
  const files = args.positionals.length > 0 ? expandPaths(root, args.positionals) : discoverFiles(root);
  const report = lintFiles(root, files);
  if (args.flag('json')) {
    process.stdout.write(`${JSON.stringify(report.findings, null, 2)}\n`);
  } else {
    for (const finding of report.findings) process.stderr.write(`${formatFinding(finding)}\n`);
  }
  process.stderr.write(`${formatSummary(report)}\n`);
  return report.findings.length === 0 ? ExitCodes.success : ExitCodes.failure;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  const described = describeError(error);
  process.stderr.write(`error: ${described.message}\n${described.hint}\n`);
  process.exitCode = described.exitCode;
}
