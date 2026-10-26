import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DataFileError } from '../../src/errors/vision-forge-error.ts';
import { isAllowedLicense } from '../../src/licenses/allowlist.ts';
import { checkLicenses } from '../../src/licenses/check.ts';
import { readInstalledPackages } from '../../src/licenses/installed-packages.ts';
import { licenseOverrides } from '../../src/licenses/overrides.ts';
import { parseSpdxExpression } from '../../src/licenses/spdx.ts';

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'licenses');

/** A package directory with a minimal MIT manifest; returns the directory. */
function writePackageDir(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }), 'utf8');
  return dir;
}

/** A project root with the given lock "packages" map and one installed package per key. */
function writeProject(root: string, lockPackages: Readonly<Record<string, unknown>>): void {
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: lockPackages }), 'utf8');
  for (const path of Object.keys(lockPackages)) writePackageDir(join(root, ...path.split('/')), path.slice('node_modules/'.length));
}

/** A link to a directory: a junction on Windows (no privilege needed), a symlink elsewhere. */
function linkDirectory(target: string, link: string): void {
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

describe('readInstalledPackages', () => {
  let tempDir = '';
  before(() => { tempDir = mkdtempSync(join(tmpdir(), 'vf-packages-')); });
  after(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('finds top-level, scoped and nested packages in path order and skips hidden entries', () => {
    const packages = readInstalledPackages(fixtureRoot);
    assert.deepEqual(packages.map((pkg) => pkg.path), [
      'node_modules/@scope/alpha',
      'node_modules/beta',
      'node_modules/beta/node_modules/gamma',
      'node_modules/copyleft',
      'node_modules/gamma',
      'node_modules/legacy',
      'node_modules/no-license',
    ]);
  });

  it('reads names, versions, licenses in every shape, normalized repositories and the dev flag from the lock file', () => {
    const byPath = new Map(readInstalledPackages(fixtureRoot).map((pkg) => [pkg.path, pkg]));
    assert.deepEqual(byPath.get('node_modules/@scope/alpha'), { name: '@scope/alpha', version: '1.0.0', path: 'node_modules/@scope/alpha', license: 'MIT', repository: 'https://github.com/scope/alpha', dev: false });
    assert.deepEqual(byPath.get('node_modules/legacy'), { name: 'legacy', version: '0.1.0', path: 'node_modules/legacy', license: 'ISC', repository: 'https://github.com/example/legacy', dev: false });
    assert.deepEqual(byPath.get('node_modules/beta/node_modules/gamma'), { name: 'gamma', version: '1.5.0', path: 'node_modules/beta/node_modules/gamma', license: 'BSD-3-Clause', repository: 'https://github.com/example/gamma', dev: false });
    assert.deepEqual(byPath.get('node_modules/gamma'), { name: 'gamma', version: '1.0.0', path: 'node_modules/gamma', license: 'MIT', repository: 'https://github.com/example/gamma', dev: true });
    assert.deepEqual(byPath.get('node_modules/no-license'), { name: 'no-license', version: '3.0.0', path: 'node_modules/no-license', license: undefined, repository: undefined, dev: true });
    assert.equal(byPath.get('node_modules/copyleft')?.repository, 'https://github.com/example/copyleft');
  });

  it('marks only "dev": true as development; optional and devOptional packages stay production', () => {
    const root = join(tempDir, 'lock-flags');
    writeProject(root, {
      'node_modules/dev-only': { version: '1.0.0', dev: true },
      'node_modules/optional-only': { version: '1.0.0', optional: true },
      'node_modules/dev-optional': { version: '1.0.0', devOptional: true },
      'node_modules/dev-and-optional': { version: '1.0.0', dev: true, optional: true },
      'node_modules/plain': { version: '1.0.0' },
    });
    assert.deepEqual(readInstalledPackages(root).map((pkg) => [pkg.name, pkg.dev]), [
      ['dev-and-optional', true],
      ['dev-only', true],
      ['dev-optional', false],
      ['optional-only', false],
      ['plain', false],
    ]);
  });

  it('follows a link to a package directory and skips a dangling one', () => {
    const root = join(tempDir, 'linked');
    writeProject(root, {});
    const target = writePackageDir(join(root, 'packages', 'linked'), 'linked');
    linkDirectory(target, join(root, 'node_modules', 'linked'));
    const gone = writePackageDir(join(root, 'packages', 'gone'), 'gone');
    linkDirectory(gone, join(root, 'node_modules', 'dangling'));
    rmSync(gone, { recursive: true });
    assert.deepEqual(readInstalledPackages(root).map((pkg) => [pkg.name, pkg.path, pkg.license]), [['linked', 'node_modules/linked', 'MIT']]);
  });

  it('reports a missing node_modules with its path and a hint', () => {
    const root = join(tempDir, 'empty');
    mkdirSync(root);
    assert.throws(() => readInstalledPackages(root), (error: unknown) => error instanceof DataFileError && error.path === join(root, 'node_modules') && /npm ci/.test(error.hint));
  });

  it('reports a lock file without a packages map', () => {
    const root = join(tempDir, 'old-lock');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'package-lock.json'), '{ "lockfileVersion": 1 }\n', 'utf8');
    assert.throws(() => readInstalledPackages(root), (error: unknown) => error instanceof DataFileError && /"packages" map/.test(error.message));
  });
});

describe('checkLicenses', () => {
  it('lists the disallowed and the unlicensed fixture packages with their paths and reasons', () => {
    const report = checkLicenses(readInstalledPackages(fixtureRoot));
    assert.equal(report.checks.length, 7);
    assert.deepEqual(report.failures.map((failure) => [failure.pkg.path, failure.reason]), [
      ['node_modules/copyleft', 'not on the allowlist: GPL-3.0-only'],
      ['node_modules/no-license', 'no license declared in package.json'],
    ]);
  });

  it('applies an override for the exact name and version and marks it', () => {
    const overrideFor = (name: string, version: string): string | undefined => (name === 'copyleft' && version === '4.0.0' ? 'MIT' : undefined);
    const report = checkLicenses(readInstalledPackages(fixtureRoot), isAllowedLicense, overrideFor);
    const copyleft = report.checks.find((check) => check.pkg.name === 'copyleft');
    assert.deepEqual([copyleft?.allowed, copyleft?.overridden, copyleft?.license], [true, true, 'MIT']);
    assert.deepEqual(report.failures.map((failure) => failure.pkg.name), ['no-license']);
  });

  it('every override is keyed "name@version" and its value is an SPDX expression', () => {
    for (const [key, expression] of Object.entries(licenseOverrides)) {
      assert.match(key, /^(@[\w.-]+\/)?[\w.-]+@\d/, `override key "${key}" must be name@version`);
      assert.doesNotThrow(() => parseSpdxExpression(expression), `override "${key}" must be an SPDX expression`);
    }
  });
});
