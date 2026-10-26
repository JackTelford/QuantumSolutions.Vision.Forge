import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { PathTooLongError } from '../../src/errors/vision-forge-error.ts';
import { assertPathLength, defaultDataDir, removeDirectoryWithRetry, resolveOutDir, windowsPathLimit } from '../../src/fs/paths.ts';

describe('defaultDataDir', () => {
  it('uses LOCALAPPDATA on Windows', () => {
    assert.equal(defaultDataDir('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me'), join('C:\\Users\\me\\AppData\\Local', 'VisionForge'));
  });

  it('falls back to the home directory on Windows without LOCALAPPDATA', () => {
    assert.equal(defaultDataDir('win32', {}, 'C:\\Users\\me'), join('C:\\Users\\me', 'AppData', 'Local', 'VisionForge'));
  });

  it('uses Application Support on macOS and XDG on Linux', () => {
    assert.equal(defaultDataDir('darwin', {}, '/Users/me'), join('/Users/me', 'Library', 'Application Support', 'VisionForge'));
    assert.equal(defaultDataDir('linux', {}, '/home/me'), join('/home/me', '.local', 'share', 'vision-forge'));
    assert.equal(defaultDataDir('linux', { XDG_DATA_HOME: '/data' }, '/home/me'), join('/data', 'vision-forge'));
  });

  it('honors VISION_FORGE_DATA on every platform', () => {
    assert.equal(defaultDataDir('linux', { VISION_FORGE_DATA: '/x/forge' }, '/home/me'), resolve('/x/forge'));
  });

  it('never reads CLAUDE_PLUGIN_DATA', () => {
    assert.equal(defaultDataDir('linux', { CLAUDE_PLUGIN_DATA: '/plugin' }, '/home/me'), join('/home/me', '.local', 'share', 'vision-forge'));
  });
});

describe('assertPathLength', () => {
  it('throws on Windows over the limit, counting the reserve', () => {
    const long = `C:\\${'a'.repeat(windowsPathLimit - 10)}`;
    assert.doesNotThrow(() => assertPathLength(long, 0, 'win32'));
    assert.throws(() => assertPathLength(long, 20, 'win32'), PathTooLongError);
  });

  it('does nothing on other platforms', () => {
    assert.doesNotThrow(() => assertPathLength('/'.padEnd(1000, 'x'), 0, 'linux'));
  });
});

describe('resolveOutDir and removeDirectoryWithRetry', () => {
  it('creates out under the working directory by default and removes it again', async () => {
    const base = mkdtempSync(join(tmpdir(), 'vf-paths-'));
    try {
      const out = resolveOutDir(undefined, base);
      assert.equal(out, join(base, 'out'));
      assert.ok(existsSync(out));
      const explicit = resolveOutDir('deliver', base);
      assert.equal(explicit, join(base, 'deliver'));
      await removeDirectoryWithRetry(out);
      assert.equal(existsSync(out), false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
