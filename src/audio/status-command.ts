/**
 * The `status` action of the audio command: what the narration component
 * looks like under the data directory, from the disk alone, plus the
 * ledger's record of every pinned weight and the provenance file when one
 * exists. The skill runs it when a brief wants narration; `doctor` reports
 * only the two booleans of tools.json.
 */
import { existsSync } from 'node:fs';
import type { ParsedArguments } from '../cli/arguments.ts';
import type { CommandContext } from '../cli/command.ts';
import type { CommandOutput } from '../cli/result.ts';
import { DataFileError } from '../errors/vision-forge-error.ts';
import { readJsonFile } from '../fs/atomic-json.ts';
import { AssetLedger, assetLedgerPath } from '../net/asset-ledger.ts';
import type { AssetRecord } from '../net/asset-ledger.ts';
import { componentPaths, componentStatus } from './component.ts';
import type { ComponentStatus } from './component.ts';
import { kokoroWeightAssetId, kokoroWeightFiles } from './weights.ts';

/** One pinned weight and what the ledger says about it. */
export interface WeightLedgerEntry {
  readonly id: string;
  readonly path: string;
  /** The ledger record, or null when the weight was never recorded. */
  readonly record: AssetRecord | null;
}

/** The status payload. */
export interface AudioStatusData extends ComponentStatus {
  readonly paths: { readonly root: string; readonly nodeModules: string; readonly models: string; readonly provenance: string };
  readonly ledger: readonly WeightLedgerEntry[];
  /** The provenance document as written by audio install, or null when there is none or it cannot be read; its shape is not checked here. */
  readonly provenance: unknown;
  /** Why the provenance file could not be read (not JSON, over size), or null; status reports it rather than failing. */
  readonly provenanceProblem: string | null;
}

/** Reads the provenance file when there is one; a file that is not readable JSON is a condition to report, not a reason for status to fail. */
function readProvenance(path: string): { readonly provenance: unknown; readonly problem: string | null } {
  if (!existsSync(path)) return { provenance: null, problem: null };
  try {
    return { provenance: readJsonFile(path), problem: null };
  } catch (error: unknown) {
    if (!(error instanceof DataFileError)) throw error;
    return { provenance: null, problem: error.message };
  }
}

/** Runs the status action. */
export function runStatus(context: CommandContext, _args: ParsedArguments): Promise<CommandOutput> {
  const status = componentStatus(context.dataDir);
  const paths = componentPaths(context.dataDir);
  const ledger = new AssetLedger(assetLedgerPath(context.dataDir));
  ledger.load();
  const entries = kokoroWeightFiles.map((file): WeightLedgerEntry => {
    const id = kokoroWeightAssetId(file);
    return { id, path: file.path, record: ledger.find(id) ?? null };
  });
  const { provenance, problem } = readProvenance(paths.provenance);
  context.log.info(`narration: ${status.installed ? 'installed' : 'not installed'} under ${paths.root}`);
  for (const sentence of status.missing) context.log.info(`  missing: ${sentence}`);
  for (const entry of entries) context.log.info(`  ${entry.path}: ${entry.record === null ? 'not in the ledger' : `ledger sha256 ${entry.record.sha256.slice(0, 12)}, fetched ${entry.record.fetchedAt}`}`);
  if (problem !== null) context.log.warn(`  provenance: ${problem}`);
  const data: AudioStatusData = { ...status, paths: { root: paths.root, nodeModules: paths.nodeModules, models: paths.models, provenance: paths.provenance }, ledger: entries, provenance, provenanceProblem: problem };
  return Promise.resolve({ data });
}
