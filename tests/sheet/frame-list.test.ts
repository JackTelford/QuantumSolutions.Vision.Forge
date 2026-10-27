import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DataFileError } from '../../src/errors/vision-forge-error.ts';
import { framesInDirectory, parseFrameList, readFrameList } from '../../src/sheet/frame-list.ts';

describe('frame list', () => {
  let dir = '';
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-frame-list-'));
    mkdirSync(join(dir, 'frames'));
    for (const name of ['f000010.png', 'f000002.png', 'notes.txt', 'F000001.PNG']) writeFileSync(join(dir, 'frames', name), '', 'utf8');
    mkdirSync(join(dir, 'empty'));
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('takes the PNG files of a directory in name order, labelled by file name without the extension', () => {
    assert.deepEqual(framesInDirectory(join(dir, 'frames')), [
      { path: join(dir, 'frames', 'F000001.PNG'), label: 'F000001' },
      { path: join(dir, 'frames', 'f000002.png'), label: 'f000002' },
      { path: join(dir, 'frames', 'f000010.png'), label: 'f000010' },
    ]);
  });

  it('refuses a directory without PNG files', () => {
    assert.throws(() => framesInDirectory(join(dir, 'empty')), (error: unknown) => error instanceof DataFileError && /no PNG files/.test(error.message));
  });

  it('resolves relative paths in a JSON list against the list file', () => {
    const listPath = join(dir, 'list.json');
    const absolute = resolve('/abs/x.png');
    const frames = parseFrameList([{ path: 'frames/f000002.png', label: 'two' }, { path: absolute, label: 'abs' }], listPath);
    assert.deepEqual(frames, [{ path: join(dir, 'frames', 'f000002.png'), label: 'two' }, { path: absolute, label: 'abs' }]);
  });

  it('names the first bad entry of a JSON list', () => {
    assert.throws(() => parseFrameList({}, 'list.json'), (error: unknown) => error instanceof DataFileError && /not a JSON array/.test(error.message));
    assert.throws(() => parseFrameList([{ path: 'a.png', label: 'a' }, { label: 'b' }], 'list.json'), (error: unknown) => error instanceof DataFileError && /entry 1 has no "path"/.test(error.message));
    assert.throws(() => parseFrameList([{ path: 'a.png' }], 'list.json'), (error: unknown) => error instanceof DataFileError && /entry 0 has no "label"/.test(error.message));
    assert.throws(() => parseFrameList([], 'list.json'), (error: unknown) => error instanceof DataFileError && /lists no frames/.test(error.message));
  });

  it('reads a directory or a JSON file from disk and reports a missing path', () => {
    const listPath = join(dir, 'list.json');
    writeFileSync(listPath, JSON.stringify([{ path: 'frames/f000010.png', label: 'ten' }]), 'utf8');
    assert.deepEqual(readFrameList(listPath), [{ path: join(dir, 'frames', 'f000010.png'), label: 'ten' }]);
    assert.equal(readFrameList(join(dir, 'frames')).length, 3);
    assert.throws(() => readFrameList(join(dir, 'missing')), (error: unknown) => error instanceof DataFileError && /does not exist/.test(error.message));
  });
});
