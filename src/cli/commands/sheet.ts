/**
 * `sheet`: placeholder until milestone M1 delivers it.
 */
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';
import { NotImplementedError } from '../../errors/vision-forge-error.ts';

/** The sheet command (not implemented yet). */
export const command: Command = {
  name: 'sheet',
  summary: 'Not implemented yet.',
  options: { strings: [], flags: [] },
  run(_context: CommandContext, _args: ParsedArguments): Promise<CommandOutput> {
    return Promise.reject(new NotImplementedError('sheet', 'M1'));
  },
};
