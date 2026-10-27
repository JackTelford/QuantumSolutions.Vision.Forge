import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assetsLedgerRules, checkAssetsLedger } from '../../../src/schema/checks/assets-ledger.ts';
import { semanticCheckCount } from '../../../src/schema/checks/index.ts';
import { assetsLedgerExample, mutated } from '../documents/examples.ts';

const noDataDir = { dataDir: undefined };

describe('checkAssetsLedger', () => {
  it('registers every rule under the assets-ledger kind', () => {
    assert.equal(semanticCheckCount('assets-ledger'), assetsLedgerRules.length);
    assert.equal(assetsLedgerRules.length, 2);
  });

  it('passes the example, whose records are sorted by id as AssetLedger.save() writes them', () => {
    assert.deepEqual(checkAssetsLedger(assetsLedgerExample, noDataDir), []);
  });

  it('accepts an empty ledger and one with a single record', () => {
    assert.deepEqual(checkAssetsLedger(mutated(assetsLedgerExample, (copy) => { copy.assets = []; }), noDataDir), []);
    assert.deepEqual(checkAssetsLedger(mutated(assetsLedgerExample, (copy) => { copy.assets.pop(); }), noDataDir), []);
  });

  it('reports an id recorded twice, once, together with the order the repeat breaks', () => {
    const atTheEnd = checkAssetsLedger(mutated(assetsLedgerExample, (copy) => {
      const font = copy.assets[0];
      if (font !== undefined) copy.assets.push({ ...font });
    }), noDataDir);
    assert.deepEqual(atTheEnd, ['asset id "font:inter" is recorded more than once', 'assets are not sorted by id: "hdri:studio_small_09" precedes "font:inter"']);
    const adjacent = checkAssetsLedger(mutated(assetsLedgerExample, (copy) => {
      const font = copy.assets[0];
      if (font !== undefined) copy.assets.splice(1, 0, { ...font });
    }), noDataDir);
    assert.deepEqual(adjacent, ['asset id "font:inter" is recorded more than once', 'assets are not sorted by id: "font:inter" precedes "font:inter"']);
  });

  it('reports records out of order, naming the first pair that breaks the order', () => {
    const problems = checkAssetsLedger(mutated(assetsLedgerExample, (copy) => { copy.assets.reverse(); }), noDataDir);
    assert.deepEqual(problems, ['assets are not sorted by id: "hdri:studio_small_09" precedes "font:inter"']);
  });
});
