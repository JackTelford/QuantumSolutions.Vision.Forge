import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PathTooLongError } from '../../src/errors/vision-forge-error.ts';
import { windowsPathLimit } from '../../src/fs/paths.ts';
import { assertCachePathLength, deepestCachePath, frameFileName, framePath, framePattern, framesDir, manifestPath, pageDir, shotCacheDir } from '../../src/render/cache.ts';
import { hex64 } from '../schema/documents/examples.ts';

describe('shot cache paths', () => {
  const dataDir = 'C:\\vf\\data';
  const cacheDir = shotCacheDir(dataDir, hex64('a'));

  it('puts a shot under <dataDir>/cache/<key> with frames, manifest.json and page inside', () => {
    assert.equal(cacheDir, join(dataDir, 'cache', hex64('a')));
    assert.equal(framesDir(cacheDir), join(cacheDir, 'frames'));
    assert.equal(manifestPath(cacheDir), join(cacheDir, 'manifest.json'));
    assert.equal(pageDir(cacheDir), join(cacheDir, 'page'));
  });

  it('names frames with six digits', () => {
    assert.equal(frameFileName(0), 'f000000.png');
    assert.equal(frameFileName(12), 'f000012.png');
    assert.equal(frameFileName(999999), 'f999999.png');
    assert.equal(framePath(framesDir(cacheDir), 7), join(cacheDir, 'frames', 'f000007.png'));
  });

  it('refuses a frame number the scheme cannot name', () => {
    assert.throws(() => frameFileName(-1), RangeError);
    assert.throws(() => frameFileName(1.5), RangeError);
    assert.throws(() => frameFileName(1_000_000), RangeError);
  });

  it('builds the printf pattern with forward slashes for ffmpeg and the assembly plan', () => {
    assert.equal(framePattern('C:\\vf\\data\\cache\\k\\frames'), 'C:/vf/data/cache/k/frames/f%06d.png');
    assert.equal(framePattern('/home/me/.local/share/vision-forge/cache/k/frames'), '/home/me/.local/share/vision-forge/cache/k/frames/f%06d.png');
  });

  it('checks the deepest path, a frame file, against the Windows limit', () => {
    assert.equal(deepestCachePath(cacheDir), join(cacheDir, 'frames', 'f000000.png'));
    assert.doesNotThrow(() => assertCachePathLength(cacheDir));
    const deep = shotCacheDir(`C:\\${'x'.repeat(windowsPathLimit)}`, hex64('b'));
    if (process.platform === 'win32') assert.throws(() => assertCachePathLength(deep), PathTooLongError);
    else assert.doesNotThrow(() => assertCachePathLength(deep));
  });
});
