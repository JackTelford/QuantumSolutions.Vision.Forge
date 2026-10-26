import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ToolMissingError, VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import { assertServedRoot, findRoot, resolveWithinRoot, threeVendorPrefix, threeVendorRoot, threeVendorRootUnder } from '../../src/harness/static-roots.ts';
import type { ServedRoot } from '../../src/harness/static-roots.ts';

const root: ServedRoot = { urlPrefix: '/site/', directory: join(tmpdir(), 'vf-static-root') };
const base = resolve(root.directory);
const onWindows = process.platform === 'win32';

/** True for the error assertServedRoot throws when the message names the label and the offending value. */
function servedRootError(label: string, value: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof VisionForgeError && error.code === 'harness-server' && error.message.includes(label) && error.message.includes(value) && error.hint.length > 0;
}

describe('resolveWithinRoot', () => {
  it('maps a URL path to the file inside the root', () => {
    assert.equal(resolveWithinRoot(root, '/site/app/main.ts'), join(base, 'app', 'main.ts'));
  });

  it('percent-decodes file names', () => {
    assert.equal(resolveWithinRoot(root, '/site/my%20file.ts'), join(base, 'my file.ts'));
  });

  it('returns the directory itself for the bare prefix', () => {
    assert.equal(resolveWithinRoot(root, '/site/'), base);
  });

  it('refuses paths that climb out of the root after decoding', () => {
    for (const path of ['/site/..%2Fsecret.txt', '/site/..%2F..%2Fsecret.txt', '/site/../secret.txt', '/site/a/..%2F..%2Fsecret.txt', '/site/%2e%2e/secret.txt', '/site/..']) {
      assert.equal(resolveWithinRoot(root, path), undefined, path);
    }
  });

  it('refuses a POSIX absolute path smuggled into the request', () => {
    assert.equal(resolveWithinRoot(root, '/site//etc/passwd'), undefined);
  });

  // A drive letter or a UNC prefix is absolute only on Windows; on POSIX "C:\Windows\win.ini" is an ordinary file name inside the root.
  it('refuses Windows absolute paths smuggled into the request', { skip: onWindows ? false : 'drive letters and UNC prefixes are absolute only on Windows' }, () => {
    for (const path of ['/site/C:%5CWindows%5Cwin.ini', '/site/%5C%5Cserver%5Cshare%5Cx']) {
      assert.equal(resolveWithinRoot(root, path), undefined, path);
    }
  });

  it('keeps a Windows-looking name inside the root on POSIX', { skip: onWindows ? 'only meaningful on POSIX' : false }, () => {
    const resolved = resolveWithinRoot(root, '/site/C:%5CWindows%5Cwin.ini');
    assert.ok(resolved !== undefined && resolved.startsWith(root.directory));
  });

  // On POSIX a backslash is an ordinary file-name character, so these are only traversals on Windows.
  it('refuses backslash traversal on Windows', { skip: onWindows ? false : 'backslashes separate paths only on Windows' }, () => {
    for (const path of ['/site/..%5Csecret.txt', '/site/app%5C..%5C..%5Csecret.txt', '/site/%2e%2e%5Csecret.txt', '/site/..%5C']) {
      assert.equal(resolveWithinRoot(root, path), undefined, path);
    }
  });

  it('refuses malformed encoding and null bytes', () => {
    assert.equal(resolveWithinRoot(root, '/site/%ZZ.ts'), undefined);
    assert.equal(resolveWithinRoot(root, '/site/a%00.ts'), undefined);
  });

  it('refuses a path outside the prefix', () => {
    assert.equal(resolveWithinRoot(root, '/other/x.ts'), undefined);
    assert.equal(resolveWithinRoot(root, '/sitex/x.ts'), undefined);
  });

  it('never returns a path outside the root directory', () => {
    const resolved = resolveWithinRoot(root, '/site/deep/er/../file.css');
    assert.ok(resolved !== undefined && resolved.startsWith(base + sep));
  });
});

describe('findRoot', () => {
  const site: ServedRoot = { urlPrefix: '/', directory: 'a' };
  const vendor: ServedRoot = { urlPrefix: '/vendor/three/', directory: 'b' };

  it('picks the longest matching prefix whatever the list order', () => {
    assert.equal(findRoot([site, vendor], '/vendor/three/package.json'), vendor);
    assert.equal(findRoot([vendor, site], '/vendor/three/package.json'), vendor);
    assert.equal(findRoot([vendor, site], '/index.html'), site);
  });

  it('returns undefined when no prefix matches', () => {
    assert.equal(findRoot([vendor], '/elsewhere/x'), undefined);
  });
});

describe('assertServedRoot', () => {
  let dir = '';
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-served-root-'));
    writeFileSync(join(dir, 'file.txt'), 'x', 'utf8');
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('accepts a slash-delimited prefix on an existing absolute directory', () => {
    assertServedRoot({ urlPrefix: '/site/', directory: dir }, 'roots[0]');
    assertServedRoot({ urlPrefix: '/', directory: dir }, 'roots[1]');
  });

  it('names the prefix that does not start and end with a slash', () => {
    assert.throws(() => assertServedRoot({ urlPrefix: 'site/', directory: dir }, 'roots[0]'), servedRootError('roots[0].urlPrefix', 'site/'));
    assert.throws(() => assertServedRoot({ urlPrefix: '/site', directory: dir }, 'roots[2]'), servedRootError('roots[2].urlPrefix', '/site'));
  });

  it('names a relative directory', () => {
    assert.throws(() => assertServedRoot({ urlPrefix: '/site/', directory: 'relative/dir' }, 'roots[0]'), servedRootError('roots[0].directory', 'relative/dir'));
  });

  it('names a directory that is missing or is a file', () => {
    const missing = join(dir, 'missing');
    const file = join(dir, 'file.txt');
    assert.throws(() => assertServedRoot({ urlPrefix: '/site/', directory: missing }, 'roots[0]'), servedRootError('roots[0].directory', missing));
    assert.throws(() => assertServedRoot({ urlPrefix: '/site/', directory: file }, 'roots[0]'), servedRootError('roots[0].directory', file));
  });
});

describe('threeVendorRoot', () => {
  let missingRepo = '';
  before(() => { missingRepo = mkdtempSync(join(tmpdir(), 'vf-no-three-')); });
  after(() => { rmSync(missingRepo, { recursive: true, force: true }); });

  it('throws a ToolMissingError with an install hint when node_modules/three is absent', () => {
    assert.throws(() => threeVendorRootUnder(missingRepo), (error: unknown) => error instanceof ToolMissingError && /npm ci/.test(error.hint));
  });

  it('maps /vendor/three/ to the installed package of this repository', (context) => {
    let vendor: ServedRoot;
    try {
      vendor = threeVendorRoot();
    } catch {
      context.skip('node_modules/three is not installed');
      return;
    }
    assert.equal(vendor.urlPrefix, threeVendorPrefix);
    assert.ok(vendor.directory.endsWith(join('node_modules', 'three')));
    assert.ok(existsSync(join(vendor.directory, 'package.json')));
  });
});
