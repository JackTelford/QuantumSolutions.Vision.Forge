/**
 * The `install` action of the audio command: `audio install [--yes]
 * [--verify]`. Without --yes it prints the sizes and the third-party notice
 * and exits 0 with `confirmed: false`, because the skill asks the user
 * before anything is fetched (ADR 0007); --verify re-hashes weight files
 * that are already present, and each entry of data.weights says in
 * `verified` whether its hash came from a download, a re-hash or the ledger
 * (`unchecked` before --yes). The provenance file is the result's evidence.
 * --verify does not bypass the confirmation: a file that fails the re-hash
 * is downloaded again, which is what the user confirms.
 */
import type { ParsedArguments } from '../cli/arguments.ts';
import type { CommandContext } from '../cli/command.ts';
import type { CommandOutput } from '../cli/result.ts';
import { installNarration } from './install.ts';

/** Runs the install action; the data is an InstallNarrationResult. */
export async function runInstall(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
  const result = await installNarration({
    dataDir: context.dataDir,
    runner: context.runner,
    log: context.log,
    signal: context.signal,
    now: context.now,
    confirm: args.flag('yes'),
    verify: args.flag('verify'),
  });
  return { data: result, evidence: result.provenancePath === null ? [] : [result.provenancePath] };
}
