import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DataFileError, VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import { readJsonFile } from '../../src/fs/atomic-json.ts';
import { AssetLedger, assetLedgerPath } from '../../src/net/asset-ledger.ts';
import type { AssetRecord } from '../../src/net/asset-ledger.ts';

const font: AssetRecord = {
  id: 'font:inter',
  source: 'https://github.com/google/fonts/raw/main/ofl/inter/OFL.txt',
  finalUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt',
  license: 'OFL-1.1',
  bytes: 1953,
  sha256: 'a'.repeat(64),
  fetchedAt: '2026-10-26T12:00:00.000Z',
  files: ['fonts/inter/OFL.txt'],
};

const hdri: AssetRecord = {
  id: 'hdri:studio_small_09',
  source: 'https://dl.polyhaven.com/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
  finalUrl: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
  license: 'CC0-1.0',
  bytes: 1615248,
  sha256: 'b'.repeat(64),
  md5: 'c'.repeat(32),
  fetchedAt: '2026-10-26T12:01:00.000Z',
  credit: 'HDRI by Poly Haven (CC0)',
  files: ['hdri/studio_small_09_1k.hdr', 'hdri/studio_small_09.json'],
};

describe('AssetLedger', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-ledger-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('names assets.json inside the data directory', () => {
    assert.equal(basename(assetLedgerPath('C:\\vf')), 'assets.json');
    assert.equal(dirname(assetLedgerPath('C:\\vf')), 'C:\\vf');
  });

  it('is empty when the file does not exist yet', () => {
    const ledger = new AssetLedger(join(dir, 'none', 'assets.json'));
    ledger.load();
    assert.deepEqual(ledger.all(), []);
    assert.equal(ledger.find('font:inter'), undefined);
  });

  it('round-trips records through assets.json, sorted by id', () => {
    const path = join(dir, 'round-trip', 'assets.json');
    const ledger = new AssetLedger(path);
    ledger.record(hdri);
    ledger.record(font);
    ledger.save();
    assert.deepEqual(readdirSync(join(dir, 'round-trip')), ['assets.json']);
    const document = readJsonFile(path) as { readonly kind: string; readonly version: number };
    assert.equal(document.kind, 'assets-ledger');
    assert.equal(document.version, 1);
    const loaded = new AssetLedger(path);
    loaded.load();
    assert.deepEqual(loaded.all().map((record) => record.id), ['font:inter', 'hdri:studio_small_09']);
    assert.deepEqual(loaded.find('hdri:studio_small_09'), hdri);
    assert.deepEqual(loaded.find('font:inter'), font);
  });

  it('replaces a record with the same id', () => {
    const ledger = new AssetLedger(join(dir, 'replace', 'assets.json'));
    ledger.record(font);
    ledger.record({ ...font, sha256: 'd'.repeat(64), fetchedAt: '2026-10-27T00:00:00.000Z' });
    assert.equal(ledger.all().length, 1);
    assert.equal(ledger.find('font:inter')?.sha256, 'd'.repeat(64));
    ledger.save();
    const loaded = new AssetLedger(ledger.path);
    loaded.load();
    assert.equal(loaded.all().length, 1);
    assert.equal(loaded.find('font:inter')?.fetchedAt, '2026-10-27T00:00:00.000Z');
  });

  it('refuses to record an invalid record and leaves the ledger unchanged', () => {
    const ledger = new AssetLedger(join(dir, 'invalid', 'assets.json'));
    ledger.record(font);
    const rejects = (record: AssetRecord, reason: RegExp): void => {
      assert.throws(() => ledger.record(record), (error: unknown) => error instanceof VisionForgeError && error.code === 'ledger-record' && reason.test(error.message) && /bug/.test(error.hint));
    };
    rejects({ ...font, id: '' }, /^Cannot record asset "": it has no "id" string\.$/);
    rejects({ ...hdri, bytes: -1 }, /has no non-negative integer "bytes"/);
    rejects({ ...hdri, license: '' }, /has no "license" string/);
    rejects({ ...hdri, files: [1] } as unknown as AssetRecord, /has no "files" array of strings/);
    assert.deepEqual(ledger.all(), [font]);
    assert.equal(existsSync(ledger.path), false);
  });

  it('throws DataFileError naming the path for a file of the wrong kind, version or shape', () => {
    const cases: readonly { readonly name: string; readonly text: string; readonly reason: RegExp }[] = [
      { name: 'not-json', text: '{nope', reason: /not valid JSON/ },
      { name: 'array', text: '[]', reason: /not a JSON object/ },
      { name: 'kind', text: JSON.stringify({ kind: 'other', version: 1, assets: [] }), reason: /kind is "other"/ },
      { name: 'version', text: JSON.stringify({ kind: 'assets-ledger', version: 2, assets: [] }), reason: /version is 2/ },
      { name: 'assets', text: JSON.stringify({ kind: 'assets-ledger', version: 1, assets: 'no' }), reason: /"assets" field is not an array/ },
      { name: 'record', text: JSON.stringify({ kind: 'assets-ledger', version: 1, assets: [{ ...font, bytes: 'many' }] }), reason: /assets\[0\] has no non-negative integer "bytes"/ },
      { name: 'files', text: JSON.stringify({ kind: 'assets-ledger', version: 1, assets: [{ ...font, files: [1] }] }), reason: /assets\[0\] has no "files" array of strings/ },
      { name: 'missing', text: JSON.stringify({ kind: 'assets-ledger', version: 1, assets: [font, { ...hdri, license: '' }] }), reason: /assets\[1\] has no "license" string/ },
    ];
    for (const testCase of cases) {
      const path = join(dir, `${testCase.name}.json`);
      writeFileSync(path, testCase.text, 'utf8');
      const ledger = new AssetLedger(path);
      assert.throws(() => ledger.load(), (error: unknown) => error instanceof DataFileError && error.path === path && testCase.reason.test(error.message), testCase.name);
    }
  });
});
