import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { readJsonFile } from '../../../src/fs/atomic-json.ts';
import { AssetLedger, assetLedgerPath } from '../../../src/net/asset-ledger.ts';
import { runSemanticChecks, semanticCheckCount } from '../../../src/schema/checks/index.ts';
import { assertKind, validateDocument } from '../../../src/schema/validator.ts';
import { assetsLedgerExample, mutated, schemaProblems } from './examples.ts';

const noDataDir = { dataDir: undefined };

describe('assets-ledger documents', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-ledger-schema-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('the example validates against the schema and passes both semantic checks', () => {
    validateDocument('assets-ledger', assetsLedgerExample);
    assert.equal(semanticCheckCount('assets-ledger'), 2);
    assert.deepEqual(runSemanticChecks('assets-ledger', assetsLedgerExample, noDataDir), []);
  });

  it('a file written by AssetLedger.save() validates', () => {
    const ledger = new AssetLedger(assetLedgerPath(dir));
    for (const record of assetsLedgerExample.assets) ledger.record(record);
    ledger.save();
    const document = readJsonFile(ledger.path);
    assert.equal(assertKind(document), 'assets-ledger');
    validateDocument('assets-ledger', document);
    assert.deepEqual(document, assetsLedgerExample);
  });

  it('an empty ledger validates', () => {
    const ledger = new AssetLedger(join(dir, 'empty', 'assets.json'));
    ledger.save();
    validateDocument('assets-ledger', readJsonFile(ledger.path));
  });

  it('rejects a negative size and a short md5, naming the record index', () => {
    const problems = schemaProblems('assets-ledger', mutated(assetsLedgerExample, (copy) => {
      (copy.assets[0] as { bytes: number }).bytes = -1;
      (copy.assets[1] as { md5: string }).md5 = 'abc';
    }));
    assert.equal(problems.length, 2);
    assert.equal(problems[0], '/assets/0/bytes: must be >= 0');
    assert.match(problems[1] ?? '', /^\/assets\/1\/md5: must match pattern/);
  });

  it('rejects a record without files and one with an unknown property', () => {
    const problems = schemaProblems('assets-ledger', mutated(assetsLedgerExample, (copy) => {
      delete (copy.assets[0] as { files?: unknown }).files;
      (copy.assets[1] as { mirror?: string }).mirror = 'https://example.com';
    }));
    assert.deepEqual(problems, ["/assets/0: must have required property 'files'", '/assets/1: must NOT have additional properties (found "mirror")']);
  });

  it('rejects a fetchedAt that is not a date-time', () => {
    assert.deepEqual(schemaProblems('assets-ledger', mutated(assetsLedgerExample, (copy) => { (copy.assets[0] as { fetchedAt: string }).fetchedAt = '2026-10-26'; })), ['/assets/0/fetchedAt: must match format "date-time"']);
  });
});
