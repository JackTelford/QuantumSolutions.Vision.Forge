/**
 * `render`: placeholder until the M3 implementation replaces this file; it
 * reports the command as not implemented so the registry can already name
 * its loader.
 */
import { NotImplementedError } from '../../errors/vision-forge-error.ts';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';

/** The render command. */
export const command: Command = {
  name: 'render',
  summary: 'Not implemented yet (M3).',
  options: { strings: [], flags: [] },
  run(_context: CommandContext, _args: ParsedArguments): Promise<CommandOutput> {
    return Promise.reject(new NotImplementedError('render', 'M3'));
  },
};
