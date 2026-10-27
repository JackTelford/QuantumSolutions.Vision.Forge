/**
 * The one impure part of the semantic checks: looking asset ids up in the
 * asset ledger under the data directory. Without a data directory nothing is
 * looked up and nothing is reported.
 */
import { AssetLedger, assetLedgerPath } from '../../net/asset-ledger.ts';
import type { CheckContext } from './rule.ts';

/** An asset id the ledger does not record, with the ledger file that was consulted. */
export interface MissingAsset {
  /** The id that was looked up, for example "model:bottle". */
  readonly id: string;
  /** Absolute path of the ledger file that does not record it. */
  readonly ledgerPath: string;
}

const missingAssetPhrase = ', which is not in the asset ledger at ';

/**
 * The ids, in order, that the ledger at `assets.json` under the data
 * directory does not record, each with the ledger path. The ledger is read
 * once per call. A missing ledger file is an empty ledger, so every id is
 * missing; a malformed one throws DataFileError, which is a problem with the
 * data directory rather than with the document. Without a data directory
 * nothing is looked up and nothing is missing.
 */
export function missingAssetIds(context: CheckContext, ids: readonly string[]): readonly MissingAsset[] {
  if (context.dataDir === undefined || ids.length === 0) return [];
  const ledgerPath = assetLedgerPath(context.dataDir);
  const ledger = new AssetLedger(ledgerPath);
  ledger.load();
  return ids.filter((id) => ledger.find(id) === undefined).map((id) => ({ id, ledgerPath }));
}

/** The sentence a missing asset is reported with; `what` names the field that carries the id. */
export function missingAssetProblem(what: string, missing: MissingAsset): string {
  return `${what} names asset "${missing.id}"${missingAssetPhrase}${missing.ledgerPath}`;
}

/** True for a sentence missingAssetProblem produced, so a caller can point at the ledger in its hint. */
export function isMissingAssetProblem(problem: string): boolean {
  return problem.includes(missingAssetPhrase);
}
