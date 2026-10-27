/**
 * Semantic checks on an asset ledger that its schema cannot express: every
 * record has its own id and the records are sorted by id, as
 * src/net/asset-ledger.ts writes them. Pure.
 */
import type { AssetsLedger } from '../../shared/contracts/assets-ledger.ts';
import { duplicateIds, runRules } from './rule.ts';
import type { CheckContext, Rule } from './rule.ts';

function uniqueAssetIds(ledger: AssetsLedger): readonly string[] {
  return duplicateIds(ledger.assets.map((asset) => asset.id)).map((id) => `asset id "${id}" is recorded more than once`);
}

function sortedById(ledger: AssetsLedger): readonly string[] {
  for (let index = 0; index + 1 < ledger.assets.length; index += 1) {
    const current = ledger.assets[index];
    const next = ledger.assets[index + 1];
    if (current !== undefined && next !== undefined && current.id >= next.id) {
      return [`assets are not sorted by id: "${current.id}" precedes "${next.id}"`];
    }
  }
  return [];
}

/** The assets-ledger rules, in the order they run. */
export const assetsLedgerRules: readonly Rule<AssetsLedger>[] = [uniqueAssetIds, sortedById];

/** Problems with the ledger, one sentence each; empty when it is sound. */
export function checkAssetsLedger(ledger: AssetsLedger, context: CheckContext): readonly string[] {
  return runRules(assetsLedgerRules, ledger, context);
}
