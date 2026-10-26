import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkLicenses } from '../../src/licenses/check.ts';
import { readInstalledPackages } from '../../src/licenses/installed-packages.ts';
import { copyProductionLicenses, findLicenseFile, findNoticeFile, licenseCopyFileName, noticeCopyFileName } from '../../src/licenses/license-files.ts';

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'licenses');

function writePackage(root: string, name: string, version: string, licenseText: string | undefined, noticeText?: string): void {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }), 'utf8');
  if (licenseText !== undefined) writeFileSync(join(dir, 'LICENSE'), licenseText, 'utf8');
  if (noticeText !== undefined) writeFileSync(join(dir, 'NOTICE.txt'), noticeText, 'utf8');
}

function writeFiles(dir: string, names: readonly string[]): string {
  mkdirSync(dir);
  for (const name of names) writeFileSync(join(dir, name), 'x', 'utf8');
  return dir;
}

describe('license-files', () => {
  let tempDir = '';
  before(() => { tempDir = mkdtempSync(join(tmpdir(), 'vf-license-files-')); });
  after(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('names copies after the package without the scope marker', () => {
    assert.equal(licenseCopyFileName('@img/sharp-win32-x64', '0.34.5'), 'img-sharp-win32-x64-0.34.5.txt');
    assert.equal(licenseCopyFileName('three', '0.186.1'), 'three-0.186.1.txt');
    assert.equal(noticeCopyFileName('playwright-core', '1.64.1'), 'playwright-core-1.64.1-NOTICE.txt');
    assert.equal(noticeCopyFileName('@scope/alpha', '1.0.0'), 'scope-alpha-1.0.0-NOTICE.txt');
  });

  it('prefers a plain LICENSE file in any case over variants and accepts COPYING', () => {
    assert.equal(findLicenseFile(writeFiles(join(tempDir, 'find'), ['LICENSE.md', 'license', 'README.md'])), 'license');
    assert.equal(findLicenseFile(writeFiles(join(tempDir, 'copying'), ['COPYING'])), 'COPYING');
    assert.equal(findLicenseFile(writeFiles(join(tempDir, 'none'), [])), undefined);
  });

  it('finds NOTICE, NOTICE.md or NOTICE.txt, the plain name first, and ignores other notices', () => {
    assert.equal(findNoticeFile(writeFiles(join(tempDir, 'notice-plain'), ['NOTICE.txt', 'NOTICE', 'ThirdPartyNotices.txt'])), 'NOTICE');
    assert.equal(findNoticeFile(writeFiles(join(tempDir, 'notice-md'), ['notice.md', 'LICENSE'])), 'notice.md');
    assert.equal(findNoticeFile(writeFiles(join(tempDir, 'notice-none'), ['LICENSE', 'ThirdPartyNotices.txt'])), undefined);
  });

  it('copies the production license and NOTICE texts under their normalized names and removes stale copies', () => {
    const destination = join(tempDir, 'docs-licenses');
    mkdirSync(destination);
    writeFileSync(join(destination, 'stale-0.0.1.txt'), 'old', 'utf8');
    writeFileSync(join(destination, 'stale-0.0.1-NOTICE.txt'), 'old notice', 'utf8');
    writeFileSync(join(destination, 'keep.md'), 'not a copy', 'utf8');
    const report = checkLicenses(readInstalledPackages(fixtureRoot));
    const copies = copyProductionLicenses(fixtureRoot, report.checks, destination);
    assert.deepEqual(copies.map((copy) => [copy.file, copy.source, copy.noticeFile, copy.noticeSource]), [
      ['scope-alpha-1.0.0.txt', 'LICENSE', 'scope-alpha-1.0.0-NOTICE.txt', undefined],
      ['beta-2.0.0.txt', 'LICENSE.md', 'beta-2.0.0-NOTICE.txt', 'NOTICE'],
      ['gamma-1.5.0.txt', 'LICENSE', 'gamma-1.5.0-NOTICE.txt', undefined],
      ['legacy-0.1.0.txt', 'license', 'legacy-0.1.0-NOTICE.txt', undefined],
    ]);
    assert.deepEqual(readdirSync(destination).sort(), ['beta-2.0.0-NOTICE.txt', 'beta-2.0.0.txt', 'gamma-1.5.0.txt', 'keep.md', 'legacy-0.1.0.txt', 'scope-alpha-1.0.0.txt']);
    assert.equal(readFileSync(join(destination, 'legacy-0.1.0.txt'), 'utf8'), 'Fixture license text for legacy. It stands in for the ISC text.\n');
    assert.match(readFileSync(join(destination, 'beta-2.0.0-NOTICE.txt'), 'utf8'), /^Fixture NOTICE for beta\./);
  });

  it('normalizes CRLF to LF, adds a final newline, and reports a package that ships no license file', () => {
    const root = join(tempDir, 'crlf-project');
    writePackage(root, 'crlf', '1.0.0', 'line one\r\nline two', 'notice one\r\nnotice two');
    writePackage(root, 'bare', '2.0.0', undefined);
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }), 'utf8');
    const destination = join(root, 'out');
    const copies = copyProductionLicenses(root, checkLicenses(readInstalledPackages(root)).checks, destination);
    assert.deepEqual(copies.map((copy) => [copy.name, copy.source, copy.noticeSource]), [['bare', undefined, undefined], ['crlf', 'LICENSE', 'NOTICE.txt']]);
    assert.deepEqual(readdirSync(destination).sort(), ['crlf-1.0.0-NOTICE.txt', 'crlf-1.0.0.txt']);
    assert.equal(readFileSync(join(destination, 'crlf-1.0.0.txt'), 'utf8'), 'line one\nline two\n');
    assert.equal(readFileSync(join(destination, 'crlf-1.0.0-NOTICE.txt'), 'utf8'), 'notice one\nnotice two\n');
  });
});
