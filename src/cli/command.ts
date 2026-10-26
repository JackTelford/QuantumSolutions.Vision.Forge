/**
 * What every command implements, and the context it receives.
 */
import type { ProcessRunner } from '../process/process-runner.ts';
import type { ArgumentSpec, ParsedArguments } from './arguments.ts';
import type { Logger } from './logger.ts';
import type { CommandOutput } from './result.ts';

/** Everything a command needs that is not in its arguments. */
export interface CommandContext {
  /** Caches, tool manifest, components and browser profiles live here. */
  readonly dataDir: string;
  /** Deliverables are written here. */
  readonly outDir: string;
  readonly cwd: string;
  readonly runner: ProcessRunner;
  readonly signal: AbortSignal;
  readonly log: Logger;
  /** The current time; injected so tests are repeatable. */
  readonly now: () => Date;
}

/** A CLI command. */
export interface Command {
  readonly name: string;
  readonly summary: string;
  /** Options beyond the global ones. */
  readonly options: ArgumentSpec;
  run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput>;
}
