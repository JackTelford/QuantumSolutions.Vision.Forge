import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { computeLaneCodeHash, laneCodeHash, laneSourceDirectories, laneSourceFiles, laneSourcePaths } from '../../src/lanes/lane-code-hash.ts';

/** The files of a small repository tree, as repository-relative paths with forward slashes. */
const treeFiles: Readonly<Record<string, string>> = {
  'src/shared/motion/easing.ts': 'export const a = 1;\n',
  'src/shared/harness/protocol.ts': 'export const b = 2;\n',
  'src/browser/runtime/boot.ts': 'export const c = 3;\n',
  'src/browser/html/template.ts': 'export const d = 4;\n',
  'src/browser/three/scene.ts': 'export const e = 5;\n',
  'src/browser/html/notes.md': 'not a source file\n',
  'src/harness/browser-session.ts': 'export const f = 6;\n',
  'src/lanes/html/page.ts': 'export const g = 7;\n',
  'src/lanes/blender/resolve-scene.ts': 'export const i = 9;\n',
  'src/lanes/blender/notes.md': 'not a source file\n',
  'src/lanes/lane-code-hash.ts': 'export const h = 8;\n',
  'skills/cinematic-studio/assets/fonts/Inter.ttf': 'font bytes\n',
  'skills/cinematic-studio/assets/fonts/Inter-OFL.txt': 'licence text\n',
  'blender/apply_scene.py': 'import bpy\n',
};

const fontPath = 'skills/cinematic-studio/assets/fonts/Inter.ttf';

function writeTree(root: string, files: Readonly<Record<string, string>>, order: readonly string[]): void {
  for (const path of order) {
    const absolute = join(root, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, files[path] ?? '', 'utf8');
  }
}

describe('laneCodeHash', () => {
  let dir = '';
  let repo = '';
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-lane-hash-'));
    repo = join(dir, 'repo');
    writeTree(repo, treeFiles, Object.keys(treeFiles));
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('hashes the shared, runtime, lane and font folders plus the page module for a browser lane, and the shared and blender lane folders plus the applier for blender', () => {
    const fonts = { directory: join('skills', 'cinematic-studio', 'assets', 'fonts'), extension: '.ttf' };
    const shared = { directory: join('src', 'shared'), extension: '.ts' };
    const runtime = { directory: join('src', 'browser', 'runtime'), extension: '.ts' };
    assert.deepEqual(laneSourceDirectories('html'), [shared, runtime, { directory: join('src', 'browser', 'html'), extension: '.ts' }, fonts]);
    assert.deepEqual(laneSourceDirectories('three'), [shared, runtime, { directory: join('src', 'browser', 'three'), extension: '.ts' }, fonts]);
    assert.deepEqual(laneSourceDirectories('blender'), [shared, { directory: join('src', 'lanes', 'blender'), extension: '.ts' }]);
    assert.deepEqual(laneSourceFiles('blender'), [join('blender', 'apply_scene.py')]);
    assert.deepEqual(laneSourceFiles('html'), [join('src', 'lanes', 'html', 'page.ts')]);
    assert.deepEqual(laneSourceFiles('three'), [join('src', 'lanes', 'html', 'page.ts')]);
  });

  it('lists only the lane\'s files, sorted, with forward slashes, and never Node-side harness code or licence texts', () => {
    assert.deepEqual(laneSourcePaths('html', repo), [fontPath, 'src/browser/html/template.ts', 'src/browser/runtime/boot.ts', 'src/lanes/html/page.ts', 'src/shared/harness/protocol.ts', 'src/shared/motion/easing.ts']);
    assert.deepEqual(laneSourcePaths('three', repo), [fontPath, 'src/browser/runtime/boot.ts', 'src/browser/three/scene.ts', 'src/lanes/html/page.ts', 'src/shared/harness/protocol.ts', 'src/shared/motion/easing.ts']);
    assert.deepEqual(laneSourcePaths('blender', repo), ['blender/apply_scene.py', 'src/lanes/blender/resolve-scene.ts', 'src/shared/harness/protocol.ts', 'src/shared/motion/easing.ts']);
  });

  it('changes the blender hash and neither browser hash when a file under src/lanes/blender or the applier changes', async () => {
    const before = await Promise.all([laneCodeHash('html', repo), laneCodeHash('three', repo), laneCodeHash('blender', repo)]);
    writeFileSync(join(repo, 'src', 'lanes', 'blender', 'resolve-scene.ts'), 'export const i = 90;\n', 'utf8');
    const afterResolver = await Promise.all([laneCodeHash('html', repo), laneCodeHash('three', repo), laneCodeHash('blender', repo)]);
    assert.equal(afterResolver[0], before[0], 'html after the resolver change');
    assert.equal(afterResolver[1], before[1], 'three after the resolver change');
    assert.notEqual(afterResolver[2], before[2], 'blender after the resolver change');
    writeFileSync(join(repo, 'blender', 'apply_scene.py'), 'import bpy, sys\n', 'utf8');
    const afterApplier = await laneCodeHash('blender', repo);
    assert.notEqual(afterApplier, afterResolver[2], 'blender after the applier change');
    assert.equal(await laneCodeHash('html', repo), before[0], 'html after the applier change');
  });

  it('changes both browser hashes and not the blender hash when a font byte or the page module changes', async () => {
    const before = await Promise.all([laneCodeHash('html', repo), laneCodeHash('three', repo), laneCodeHash('blender', repo)]);
    writeFileSync(join(repo, ...fontPath.split('/')), 'font bytes changed\n', 'utf8');
    const afterFont = await Promise.all([laneCodeHash('html', repo), laneCodeHash('three', repo), laneCodeHash('blender', repo)]);
    assert.notEqual(afterFont[0], before[0], 'html after the font change');
    assert.notEqual(afterFont[1], before[1], 'three after the font change');
    assert.equal(afterFont[2], before[2], 'blender after the font change');
    writeFileSync(join(repo, 'src', 'lanes', 'html', 'page.ts'), 'export const g = 70;\n', 'utf8');
    const afterPage = await Promise.all([laneCodeHash('html', repo), laneCodeHash('three', repo), laneCodeHash('blender', repo)]);
    assert.notEqual(afterPage[0], afterFont[0], 'html after the page change');
    assert.notEqual(afterPage[1], afterFont[1], 'three after the page change');
    assert.equal(afterPage[2], before[2], 'blender after the page change');
  });

  it('is 64 lowercase hex characters and the same for the same tree', async () => {
    const first = await laneCodeHash('html', repo);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(await laneCodeHash('html', repo), first);
    assert.equal(await computeLaneCodeHash('html', repo), first);
  });

  it('changes the html hash and not the three hash when a file under src/browser/html changes', async () => {
    const htmlBefore = await laneCodeHash('html', repo);
    const threeBefore = await laneCodeHash('three', repo);
    const blenderBefore = await laneCodeHash('blender', repo);
    writeFileSync(join(repo, 'src', 'browser', 'html', 'template.ts'), 'export const d = 40;\n', 'utf8');
    assert.notEqual(await laneCodeHash('html', repo), htmlBefore);
    assert.equal(await laneCodeHash('three', repo), threeBefore);
    assert.equal(await laneCodeHash('blender', repo), blenderBefore);
  });

  it('changes every lane hash when a shared file changes', async () => {
    const before = await Promise.all([laneCodeHash('html', repo), laneCodeHash('three', repo), laneCodeHash('blender', repo)]);
    writeFileSync(join(repo, 'src', 'shared', 'motion', 'easing.ts'), 'export const a = 10;\n', 'utf8');
    const after = await Promise.all([laneCodeHash('html', repo), laneCodeHash('three', repo), laneCodeHash('blender', repo)]);
    for (let index = 0; index < before.length; index += 1) assert.notEqual(after[index], before[index], `lane ${index}`);
  });

  it('does not depend on the order files were created in', async () => {
    const forward = join(dir, 'forward');
    const backward = join(dir, 'backward');
    writeTree(forward, treeFiles, Object.keys(treeFiles));
    writeTree(backward, treeFiles, [...Object.keys(treeFiles)].reverse());
    for (const lane of ['html', 'three', 'blender'] as const) assert.equal(await laneCodeHash(lane, forward), await laneCodeHash(lane, backward), lane);
  });

  it('hashes a tree without a lane folder or an applier as the files it does have', async () => {
    const bare = join(dir, 'bare');
    writeTree(bare, treeFiles, ['src/shared/motion/easing.ts']);
    assert.deepEqual(laneSourcePaths('html', bare), ['src/shared/motion/easing.ts']);
    assert.deepEqual(laneSourcePaths('blender', bare), ['src/shared/motion/easing.ts']);
    assert.match(await laneCodeHash('three', bare), /^[0-9a-f]{64}$/);
  });

  it('hashes the real repository once per lane and returns the same promise again', async () => {
    const first = laneCodeHash('html');
    assert.equal(laneCodeHash('html'), first);
    assert.match(await first, /^[0-9a-f]{64}$/);
    assert.notEqual(await laneCodeHash('html'), await laneCodeHash('blender'));
  });
});
