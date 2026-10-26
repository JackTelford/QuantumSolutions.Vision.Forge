import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkLicenses } from '../../src/licenses/check.ts';
import { readInstalledPackages } from '../../src/licenses/installed-packages.ts';
import { findLicenseFile, findNoticeFile, licenseCopyFileName, noticeCopyFileName } from '../../src/licenses/license-files.ts';
import { externalPrograms, narrationComponents } from '../../src/licenses/notice-extras.ts';
import { renderThirdPartyNotice } from '../../src/licenses/notice.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { ProcessResult } from '../../src/process/process-runner.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = join(repoRoot, 'scripts', 'licenses.ts');
const fixtureRoot = join(repoRoot, 'tests', 'fixtures', 'licenses');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

function runScript(args: readonly string[]): Promise<ProcessResult> {
  return runner.run({ label: 'licenses', executable: process.execPath, args: [scriptPath, ...args], cwd: repoRoot, timeoutMs: 120_000 }, never);
}

describe('scripts/licenses.ts', () => {
  let tempDir = '';
  before(() => { tempDir = mkdtempSync(join(tmpdir(), 'vf-licenses-')); });
  after(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('exits 0 on this repository and lists the production dependencies on standard error', async () => {
    const result = await runScript([]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '');
    for (const name of ['ajv', 'playwright-core', 'three']) {
      assert.match(result.stderr, new RegExp(`^${name}\\s+\\S+\\s+\\S+\\s+prod$`, 'm'), `${name} must be listed as a production dependency`);
    }
    assert.match(result.stderr, /^\d+ packages checked, 0 failed\.$/m);
  });

  it('exits 1 on the fixture, names each failing package with its path, and writes nothing', async () => {
    const root = join(tempDir, 'failing');
    cpSync(fixtureRoot, root, { recursive: true });
    const result = await runScript(['--root', root, '--write']);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /^FAIL copyleft@4\.0\.0 \(node_modules\/copyleft\): not on the allowlist: GPL-3\.0-only$/m);
    assert.match(result.stderr, /^FAIL no-license@3\.0\.0 \(node_modules\/no-license\): no license declared in package\.json$/m);
    assert.match(result.stderr, /^7 packages checked, 2 failed\.$/m);
    assert.equal(existsSync(join(root, 'THIRD-PARTY.md')), false);
    assert.equal(existsSync(join(root, 'docs', 'licenses')), false);
  });

  it('writes the notice, the production license texts and the NOTICE files for a tree that passes', async () => {
    const root = join(tempDir, 'passing');
    cpSync(fixtureRoot, root, { recursive: true });
    rmSync(join(root, 'node_modules', 'copyleft'), { recursive: true });
    rmSync(join(root, 'node_modules', 'no-license'), { recursive: true });
    const result = await runScript(['--root', root, '--write']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /4 license texts and 1 NOTICE files under docs\/licenses\//);
    const notice = readFileSync(join(root, 'THIRD-PARTY.md'), 'utf8');
    assert.match(notice, /^# Third-party notices\n/);
    assert.match(notice, /^\| @scope\/alpha \| 1\.0\.0 \| MIT \| <https:\/\/github\.com\/scope\/alpha> \|$/m);
    assert.match(notice, /^\| ffmpeg \| /m);
    assert.match(notice, /^\| kokoro-js \| 1\.2\.1 \| Apache-2\.0 \| /m);
    assert.deepEqual(readdirSync(join(root, 'docs', 'licenses')).sort(), ['beta-2.0.0-NOTICE.txt', 'beta-2.0.0.txt', 'gamma-1.5.0.txt', 'legacy-0.1.0.txt', 'scope-alpha-1.0.0.txt']);
  });

  it('an unknown option is a usage error with exit code 2 and no stack trace', async () => {
    const result = await runScript(['--bogus']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /Unknown option --bogus/);
    assert.doesNotMatch(result.stderr, /at .*\.ts:\d+/);
  });

  it('the committed THIRD-PARTY.md and docs/licenses match what --write generates for this repository', () => {
    const report = checkLicenses(readInstalledPackages(repoRoot));
    assert.deepEqual(report.failures.map((failure) => `${failure.pkg.path}: ${failure.reason ?? ''}`), []);
    const expected = renderThirdPartyNotice(report.checks, { externalPrograms, narrationComponents });
    const committed = readFileSync(join(repoRoot, 'THIRD-PARTY.md'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(committed, expected, 'THIRD-PARTY.md is stale: run node scripts/licenses.ts --write');
    // Only packages that ship a license or NOTICE file produce a copy; the others only warn.
    const expectedFiles = new Set<string>();
    for (const check of report.checks.filter((entry) => !entry.pkg.dev)) {
      const packageDir = join(repoRoot, ...check.pkg.path.split('/'));
      if (findLicenseFile(packageDir) !== undefined) expectedFiles.add(licenseCopyFileName(check.pkg.name, check.pkg.version));
      if (findNoticeFile(packageDir) !== undefined) expectedFiles.add(noticeCopyFileName(check.pkg.name, check.pkg.version));
    }
    assert.deepEqual(readdirSync(join(repoRoot, 'docs', 'licenses')).filter((file) => file.endsWith('.txt')).sort(), [...expectedFiles].sort(), 'docs/licenses is stale: run node scripts/licenses.ts --write');
  });
});
