/**
 * The one program the skill calls: `node scripts/cli.ts <command> [options]`.
 *
 * Standard output carries exactly one JSON result document; progress and
 * errors go to standard error. Exit codes: 0 success, 1 failure, 2 usage,
 * 130 cancelled. Errors print their message and hint, never a stack trace.
 */
import { mergeSpecs, parseArguments } from '../src/cli/arguments.ts';
import type { CommandContext } from '../src/cli/command.ts';
import { LogLevels, StreamLogger } from '../src/cli/logger.ts';
import type { LogLevel } from '../src/cli/logger.ts';
import { CommandPlan, commandNames, isCommandName, loadCommand } from '../src/cli/registry.ts';
import { failureResult, serializeResult, successResult } from '../src/cli/result.ts';
import type { CliResult } from '../src/cli/result.ts';
import { ExitCodes, NotImplementedError, UsageError, describeError } from '../src/errors/vision-forge-error.ts';
import { resolveDataDir, resolveOutDir } from '../src/fs/paths.ts';
import { ChildProcessRunner } from '../src/process/child-process-runner.ts';

const globalOptions = { strings: ['data-dir', 'out'], flags: ['pretty', 'quiet', 'verbose'] } as const;

/** Runs the CLI for the given argv (without node and script path) and returns the result document. */
export async function runCli(argv: readonly string[], signal: AbortSignal): Promise<CliResult> {
  const commandToken = argv[0];
  if (commandToken === undefined || commandToken.startsWith('--')) {
    throw new UsageError('No command given.', `Usage: node scripts/cli.ts <${commandNames.join('|')}> [options]. Try "help".`);
  }
  if (!isCommandName(commandToken)) {
    throw new UsageError(`Unknown command "${commandToken}".`, `Commands: ${commandNames.join(', ')}. Try "help".`);
  }
  const command = await loadCommand(commandToken);
  if (command === undefined) throw new NotImplementedError(commandToken, CommandPlan[commandToken]);

  const args = parseArguments(argv.slice(1), mergeSpecs(globalOptions, command.options));
  const level: LogLevel = args.flag('quiet') ? LogLevels.quiet : args.flag('verbose') ? LogLevels.verbose : LogLevels.normal;
  const cwd = process.cwd();
  const context: CommandContext = {
    dataDir: resolveDataDir(args.string('data-dir')),
    outDir: resolveOutDir(args.string('out'), cwd),
    cwd,
    runner: new ChildProcessRunner(),
    signal,
    log: new StreamLogger(level),
    now: () => new Date(),
  };
  const output = await command.run(context, args);
  return successResult(command.name, output);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const pretty = argv.includes('--pretty');
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const commandName = argv[0] ?? '';
  try {
    const result = await runCli(argv, controller.signal);
    process.stdout.write(serializeResult(result, pretty));
    return result.exitCode;
  } catch (error: unknown) {
    const described = describeError(error);
    process.stderr.write(`error: ${described.message}\n${described.hint}\n`);
    if (described.code === 'unexpected' && error instanceof Error && error.stack !== undefined) {
      process.stderr.write(`${error.stack}\n`);
    }
    const result = failureResult(commandName, described.exitCode, { code: described.code, message: described.message, hint: described.hint }, described.evidence);
    process.stdout.write(serializeResult(result, pretty));
    return described.exitCode;
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = ExitCodes.failure;
  },
);
