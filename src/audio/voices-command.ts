/**
 * The `voices` action of the audio command: the offered voices with their
 * grades and the default, from the data in voices.ts; nothing is read from
 * the installed component, so it answers whether or not it is installed.
 */
import type { ParsedArguments } from '../cli/arguments.ts';
import type { CommandContext } from '../cli/command.ts';
import type { CommandOutput } from '../cli/result.ts';
import { defaultVoice, offeredFloor, offeredVoices } from './voices.ts';
import type { KokoroVoice } from './voices.ts';

/** The voices payload. */
export interface AudioVoicesData {
  readonly voices: readonly KokoroVoice[];
  readonly default: string;
  /** The lowest grade offered. */
  readonly floor: string;
}

/** Runs the voices action. */
export function runVoices(context: CommandContext, _args: ParsedArguments): Promise<CommandOutput> {
  for (const voice of offeredVoices) {
    context.log.info(`${voice.name}  ${voice.grade.padEnd(2)}  ${voice.accent} ${voice.gender}${voice.name === defaultVoice ? '  (default)' : ''}`);
  }
  context.log.info(`${offeredVoices.length} voices graded ${offeredFloor} or better; the default is ${defaultVoice}`);
  const data: AudioVoicesData = { voices: offeredVoices, default: defaultVoice, floor: offeredFloor };
  return Promise.resolve({ data });
}
