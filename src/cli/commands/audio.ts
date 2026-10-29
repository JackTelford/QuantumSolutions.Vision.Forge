/**
 * `audio <action>`: the optional narration component (ADR 0007). The first
 * positional names the action and each action lives in its own file under
 * src/audio/:
 *
 * - `install [--yes] [--verify]`: copies the component template into the
 *   data directory, runs npm ci through node and npm-cli.js and downloads
 *   the pinned weights; without --yes it only prints the sizes and the
 *   third-party notice (src/audio/install-command.ts).
 * - `status`: the component's state from the disk and the ledger
 *   (src/audio/status-command.ts). `doctor` keeps reporting only whether
 *   the component is installed; the skill asks `audio status` when a brief
 *   wants narration, and doctor's audio lane still means ffmpeg with the
 *   aac and pcm_s16le encoders.
 * - `voices`: the offered voices with grades and the default
 *   (src/audio/voices-command.ts).
 * - `synth --text <sentence> | --script <file> [--voice <name>] [--fps <n>]
 *   [--gap <s>] [--out-dir <dir>]`: synthesis, captions and loudness
 *   (src/audio/synth-command.ts).
 *
 * The option table lists every action's options because the parser refuses
 * what it does not know; each action reads only its own.
 */
import { runInstall } from '../../audio/install-command.ts';
import { synthOptions } from '../../audio/synth-command.ts';
import { runStatus } from '../../audio/status-command.ts';
import { runVoices } from '../../audio/voices-command.ts';
import { UsageError } from '../../errors/vision-forge-error.ts';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';

/** The actions in the order help lists them. */
export const audioActions: readonly string[] = ['install', 'status', 'voices', 'synth'];

/** The audio command. */
export const command: Command = {
  name: 'audio',
  summary: 'Narration: install the voice component (install --yes), show its state (status), list the voices (voices) or synthesise a script (synth --text|--script).',
  options: { strings: [...synthOptions.strings], flags: ['yes', 'verify'] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const [action, ...rest] = args.positionals;
    if (action === undefined) throw new UsageError('audio needs an action.', `Pass one of: ${audioActions.join(', ')}; for example audio install --yes.`);
    if (rest.length > 0) throw new UsageError(`Unexpected argument ${JSON.stringify(rest[0])}.`, `audio ${action} takes options only.`);
    switch (action) {
      case 'install':
        return runInstall(context, args);
      case 'status':
        return runStatus(context, args);
      case 'voices':
        return runVoices(context, args);
      case 'synth': {
        // Loaded on demand so the other actions answer without the synthesis module and its imports.
        const { runSynth } = await import('../../audio/synth-command.ts');
        return runSynth(context, args);
      }
      default:
        throw new UsageError(`Unknown audio action ${JSON.stringify(action)}.`, `Pass one of: ${audioActions.join(', ')}.`);
    }
  },
};
