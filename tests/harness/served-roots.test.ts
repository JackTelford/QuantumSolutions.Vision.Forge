import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fontsDirectory, renderServedRoots, repositoryRoot } from '../../src/harness/served-roots.ts';
import { threeVendorPrefix } from '../../src/harness/static-roots.ts';
import { assetsUrlPrefix, fontsUrlPrefix, pageUrlPrefix, sourceUrlPrefix } from '../../src/shared/harness/protocol.ts';

describe('renderServedRoots', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-roots-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('serves src, three, the bundled fonts, the page directory and the assets directory under the protocol prefixes, in that order', () => {
    const pageDir = join(dir, 'page');
    const dataDir = join(dir, 'data');
    const roots = renderServedRoots({ repoRoot: repositoryRoot, pageDir, dataDir });
    assert.deepEqual(roots.map((root) => root.urlPrefix), [sourceUrlPrefix, threeVendorPrefix, fontsUrlPrefix, pageUrlPrefix, assetsUrlPrefix]);
    assert.deepEqual(roots.map((root) => root.directory), [
      join(repositoryRoot, 'src'),
      join(repositoryRoot, 'node_modules', 'three'),
      join(repositoryRoot, fontsDirectory),
      pageDir,
      join(dataDir, 'assets'),
    ]);
  });

  it('creates the assets directory so an empty data directory still serves the prefix', () => {
    const dataDir = join(dir, 'fresh-data');
    assert.equal(existsSync(dataDir), false);
    renderServedRoots({ repoRoot: repositoryRoot, pageDir: dir, dataDir });
    assert.ok(statSync(join(dataDir, 'assets')).isDirectory());
  });

  it('resolves the repository root to the directory that holds package.json and the fonts', () => {
    assert.equal(repositoryRoot, resolve(import.meta.dirname, '..', '..'));
    assert.ok(existsSync(join(repositoryRoot, 'package.json')));
    assert.ok(existsSync(join(repositoryRoot, fontsDirectory, 'Inter.ttf')));
  });
});
