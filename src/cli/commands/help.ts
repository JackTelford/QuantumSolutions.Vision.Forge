/**
 * `help`: lists the commands and which milestone delivers each.
 */
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';
import { CommandPlan, commandNames } from '../registry.ts';

/** Shape of the help payload. */
export interface HelpData {
  readonly usage: string;
  readonly globalOptions: readonly string[];
  readonly commands: readonly { readonly name: string; readonly milestone: string }[];
}

/** The help command. */
export const command: Command = {
  name: 'help',
  summary: 'List the commands and the milestone that delivers each.',
  options: { strings: [], flags: [] },
  run(_context: CommandContext, _args: ParsedArguments): Promise<CommandOutput> {
    const data: HelpData = {
      usage: 'node scripts/cli.ts <command> [--data-dir <dir>] [--out <dir>] [--pretty] [--quiet] [--verbose] [command options]',
      globalOptions: ['--data-dir <dir>', '--out <dir>', '--pretty', '--quiet', '--verbose'],
      commands: commandNames.map((name) => ({ name, milestone: CommandPlan[name] })),
    };
    return Promise.resolve({ data });
  },
};
