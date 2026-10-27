import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { captionFilter, copySidecar, samePath, sidecarPath } from '../../src/assemble/captions.ts';

describe('sidecarPath', () => {
  it('puts the SRT next to the delivery under its base name', () => {
    assert.equal(sidecarPath(join('C:\\vf\\out', 'film.mp4')), join('C:\\vf\\out', 'film.srt'));
    assert.equal(sidecarPath(join('C:\\vf\\out', 'film.mov')), join('C:\\vf\\out', 'film.srt'));
  });
});

describe('samePath', () => {
  it('ignores letter case on Windows and keeps it elsewhere', () => {
    assert.equal(samePath('C:\\vf\\out\\Film.srt', 'c:\\vf\\out\\film.srt', 'win32'), true);
    assert.equal(samePath('C:\\vf\\out\\Film.srt', 'c:\\vf\\out\\film.srt', 'linux'), false);
    assert.equal(samePath('C:\\vf\\out\\film.srt', 'C:\\vf\\out\\film.srt', 'linux'), true);
    assert.equal(samePath('C:\\vf\\out\\film.srt', 'C:\\vf\\out\\other.srt', 'win32'), false);
  });
});

describe('captionFilter', () => {
  it('is the quoted subtitles filter only when burning in', () => {
    assert.equal(captionFilter({ srtPath: 'C:\\vf\\job\\cap.srt', burnIn: true }), "subtitles='C\\:/vf/job/cap.srt'");
    assert.equal(captionFilter({ srtPath: 'C:\\vf\\job\\cap.srt', burnIn: false }), undefined);
    assert.equal(captionFilter(undefined), undefined);
  });
});

describe('copySidecar', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-cap-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('copies the SRT next to the output, creating the output directory, and says it copied', () => {
    const srt = join(dir, 'source.srt');
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nHi\n', 'utf8');
    const output = join(dir, 'deep', 'out', 'film.mp4');
    const sidecar = copySidecar({ srtPath: srt, burnIn: false }, output);
    assert.deepEqual(sidecar, { path: join(dir, 'deep', 'out', 'film.srt'), copied: true });
    assert.ok(existsSync(sidecar.path));
    assert.equal(readFileSync(sidecar.path, 'utf8'), readFileSync(srt, 'utf8'));
  });

  it('leaves an SRT that already is the sidecar alone', () => {
    const output = join(dir, 'same', 'film.mp4');
    const sidecar = join(dir, 'same', 'film.srt');
    mkdirSync(join(dir, 'same'), { recursive: true });
    writeFileSync(sidecar, 'x\n', 'utf8');
    assert.deepEqual(copySidecar({ srtPath: sidecar, burnIn: true }, output), { path: sidecar, copied: false });
    assert.equal(readFileSync(sidecar, 'utf8'), 'x\n');
  });

  it('leaves an SRT that is the sidecar in another letter case alone on Windows instead of copying it onto itself', { skip: process.platform !== 'win32' ? 'case-insensitive paths are a Windows matter' : false }, () => {
    const output = join(dir, 'case', 'film.mp4');
    const sidecar = join(dir, 'case', 'film.srt');
    mkdirSync(join(dir, 'case'), { recursive: true });
    writeFileSync(sidecar, 'y\n', 'utf8');
    const shouted = join(dir, 'Case', 'FILM.SRT');
    assert.deepEqual(copySidecar({ srtPath: shouted, burnIn: true }, output), { path: sidecar, copied: false });
    assert.equal(readFileSync(sidecar, 'utf8'), 'y\n');
  });
});
