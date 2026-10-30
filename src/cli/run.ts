/**
 * Runs one command in-process and returns its result document. The CLI
 * (scripts/cli.ts) and the MCP server (src/mcp/) both go through here, so a
 * tool call and a command line do exactly the same thing: the same parser,
 * the same context, the same errors turned into the same result.
 */
import { ExitCodes, NotImplementedError, UsageError, describeError } from '../errors/vision-forge-error.ts';
import type { DescribedError } from '../errors/vision-forge-error.ts';
import { resolveDataDir, resolveOutDir } from '../fs/paths.ts';
import { ChildProcessRunner } from '../process/child-process-runner.ts';
import { mergeSpecs, parseArguments } from './arguments.ts';
import type { CommandContext } from './command.ts';
import { LogLevels, StreamLogger } from './logger.ts';
import type { LogLevel, Logger } from './logger.ts';
import { CommandPlan, commandNames, isCommandName, loadCommand } from './registry.ts';
import { failureResult, successResult } from './result.ts';
import type { CliResult } from './result.ts';

/** The options every command accepts besides its own. */
export const globalOptions = { strings: ['data-dir', 'out'], flags: ['pretty', 'quiet', 'verbose'] } as const;

/** What a caller supplies around the argv: where to log, how to cancel, and the directories when they are not in the argv. */
export interface RunOptions {
  readonly signal: AbortSignal;
  /** Receives progress; the CLI uses a StreamLogger on standard error, the MCP server forwards to the client. Absent: standard error at the argv's level. */
  readonly log?: Logger;
  /** The data directory when the argv carries no --data-dir; absent: the platform default. */
  readonly dataDir?: string;
  /** The output directory when the argv carries no --out; absent: `out` under cwd. */
  readonly outDir?: string;
  /** The working directory relative paths resolve against; absent: the process's. */
  readonly cwd?: string;
  /** Called with the described error (and the thrown value) when the command fails, before the failure result is built. */
  readonly onError?: (described: DescribedError, error: unknown) => void;
}

/** The log level the argv asks for. */
export function logLevelOf(args: { flag(name: string): boolean }): LogLevel {
  return args.flag('quiet') ? LogLevels.quiet : args.flag('verbose') ? LogLevels.verbose : LogLevels.normal;
}

/** Runs the command the argv names and returns its result; a thrown error becomes a failure result with the error's exit code. */
export async function runCommand(argv: readonly string[], options: RunOptions): Promise<CliResult> {
  const commandName = argv[0] ?? '';
  try {
    return await runOrThrow(argv, options);
  } catch (error: unknown) {
    const described = describeError(error);
    options.onError?.(described, error);
    return failureResult(commandName, described.exitCode, { code: described.code, message: described.message, hint: described.hint }, described.evidence);
  }
}

/** Runs the command the argv names; throws the command's error instead of wrapping it. */
export async function runOrThrow(argv: readonly string[], options: RunOptions): Promise<CliResult> {
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
  const cwd = options.cwd ?? process.cwd();
  const context: CommandContext = {
    dataDir: resolveDataDir(args.string('data-dir') ?? options.dataDir),
    outDir: resolveOutDir(args.string('out') ?? options.outDir, cwd),
    cwd,
    runner: new ChildProcessRunner(),
    signal: options.signal,
    log: options.log ?? new StreamLogger(logLevelOf(args)),
    now: () => new Date(),
  };
  const output = await command.run(context, args);
  return successResult(command.name, output);
}

/** The exit code a result carries, for a process that ends with it. */
export function exitCodeOf(result: CliResult): number {
  return result.ok ? ExitCodes.success : result.exitCode;
}
