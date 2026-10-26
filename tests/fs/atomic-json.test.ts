import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DataFileError } from '../../src/errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';

describe('atomic-json', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-json-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('round-trips a document and leaves no temporary file behind', () => {
    const path = join(dir, 'nested', 'doc.json');
    writeJsonAtomic(path, { a: 1, b: ['x'] });
    assert.deepEqual(readJsonFile(path), { a: 1, b: ['x'] });
    assert.deepEqual(readdirSync(join(dir, 'nested')), ['doc.json']);
  });

  it('overwrites an existing document in place', () => {
    const path = join(dir, 'again.json');
    writeJsonAtomic(path, { v: 1 });
    writeJsonAtomic(path, { v: 2 });
    assert.deepEqual(readJsonFile(path), { v: 2 });
  });

  it('reports a missing file with its path', () => {
    const path = join(dir, 'missing.json');
    assert.throws(() => readJsonFile(path), (error: unknown) => error instanceof DataFileError && error.path === path && /does not exist/.test(error.message));
  });

  it('reports invalid JSON', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{not json', 'utf8');
    assert.throws(() => readJsonFile(path), (error: unknown) => error instanceof DataFileError && /not valid JSON/.test(error.message));
  });

  it('refuses files over the size limit', () => {
    const path = join(dir, 'big.json');
    writeFileSync(path, JSON.stringify({ text: 'x'.repeat(100) }), 'utf8');
    assert.throws(() => readJsonFile(path, 50), (error: unknown) => error instanceof DataFileError && /over the 50 byte limit/.test(error.message));
  });
});
