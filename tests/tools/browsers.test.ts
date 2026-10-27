import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { browserHint, browserVersion, findBrowser, findBrowsers, knownBrowserPaths, parseBrowserVersion, powershellLiteral } from '../../src/tools/browsers.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

function touch(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '', 'utf8');
  return path;
}

describe('knownBrowserPaths', () => {
  it('tries Program Files (x86), Program Files and LOCALAPPDATA for Edge on Windows, in that order', () => {
    const env = { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\Local' };
    assert.deepEqual(knownBrowserPaths('msedge', env, 'win32'), [
      join('C:\\PF86', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join('C:\\PF', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join('C:\\Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
    assert.deepEqual(knownBrowserPaths('chrome', env, 'win32')[0], join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  });

  it('skips roots that are not set and names the app bundles on macOS', () => {
    assert.deepEqual(knownBrowserPaths('msedge', {}, 'win32'), []);
    assert.deepEqual(knownBrowserPaths('msedge', {}, 'darwin'), ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']);
    assert.deepEqual(knownBrowserPaths('chrome', {}, 'darwin'), ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
    assert.deepEqual(knownBrowserPaths('chrome', {}, 'linux'), []);
  });
});

describe('findBrowsers with a fake file tree', () => {
  let root = '';
  before(() => { root = mkdtempSync(join(tmpdir(), 'vf-browsers-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  it('finds Edge first and Chrome second from the Windows known folders', () => {
    const env = { 'ProgramFiles(x86)': join(root, 'pf86'), ProgramFiles: join(root, 'pf'), LOCALAPPDATA: join(root, 'local') };
    const edge = touch(join(root, 'pf86', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    const chrome = touch(join(root, 'pf', 'Google', 'Chrome', 'Application', 'chrome.exe'));
    assert.deepEqual(findBrowsers(env, 'win32'), {
      found: [
        { channel: 'msedge', path: edge, foundBy: 'known-folder' },
        { channel: 'chrome', path: chrome, foundBy: 'known-folder' },
      ],
      problems: [],
    });
  });

  it('finds a per-user Chrome under LOCALAPPDATA and nothing when the folders are empty', () => {
    const chrome = touch(join(root, 'user', 'Google', 'Chrome', 'Application', 'chrome.exe'));
    assert.deepEqual(findBrowsers({ LOCALAPPDATA: join(root, 'user') }, 'win32'), { found: [{ channel: 'chrome', path: chrome, foundBy: 'known-folder' }], problems: [] });
    assert.deepEqual(findBrowsers({ ProgramFiles: join(root, 'empty') }, 'win32'), { found: [], problems: [] });
  });

  it('honors CHROME for Chrome only and reports an override that is not a runnable file instead of dropping it silently', () => {
    const custom = touch(join(root, 'custom', 'chrome.exe'));
    assert.deepEqual(findBrowser('chrome', { CHROME: custom }, 'win32'), { found: { channel: 'chrome', path: custom, foundBy: 'env' }, problems: [] });
    assert.deepEqual(findBrowser('msedge', { CHROME: custom }, 'win32'), { found: undefined, problems: [] });
    const missing = join(root, 'custom', 'missing.exe');
    const refused = findBrowser('chrome', { CHROME: missing, ProgramFiles: join(root, 'pf') }, 'win32');
    assert.equal(refused.found, undefined);
    assert.equal(refused.problems.length, 1);
    assert.match(refused.problems[0] ?? '', /^CHROME is set to .*missing\.exe, which is not a runnable file; point it at the Chrome executable/);
    const edge = touch(join(root, 'pf86b', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    const all = findBrowsers({ CHROME: join(root, 'custom'), 'ProgramFiles(x86)': join(root, 'pf86b') }, 'win32');
    assert.deepEqual(all.found, [{ channel: 'msedge', path: edge, foundBy: 'known-folder' }]);
    assert.match(all.problems[0] ?? '', /CHROME is set to .*custom, which is not a runnable file/);
  });

  it('looks up the usual names on PATH on Linux, Edge before Chrome', () => {
    const bin = join(root, 'bin');
    const chrome = touch(join(bin, 'google-chrome-stable'));
    assert.deepEqual(findBrowsers({ PATH: bin }, 'linux').found, [{ channel: 'chrome', path: chrome, foundBy: 'path' }]);
    const edge = touch(join(bin, 'microsoft-edge'));
    assert.deepEqual(findBrowsers({ PATH: bin }, 'linux').found.map((browser) => browser.path), [edge, chrome]);
  });
});

describe('parseBrowserVersion and powershellLiteral', () => {
  it('extracts four dotted numbers from version output', () => {
    assert.equal(parseBrowserVersion('156.0.4314.42\r\n'), '156.0.4314.42');
    assert.equal(parseBrowserVersion('Google Chrome 156.0.8078.47 \n'), '156.0.8078.47');
    assert.equal(parseBrowserVersion('Microsoft Edge 156.0.4314.42'), '156.0.4314.42');
    assert.equal(parseBrowserVersion('nothing here'), undefined);
  });

  it('doubles single quotes inside a PowerShell literal', () => {
    assert.equal(powershellLiteral("C:\\Users\\o'brien\\chrome.exe"), "'C:\\Users\\o''brien\\chrome.exe'");
  });
});

describe('browserVersion', () => {
  let root = '';
  before(() => { root = mkdtempSync(join(tmpdir(), 'vf-browser-version-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  it('asks PowerShell for the ProductVersion on Windows', async () => {
    const bin = join(root, 'bin');
    touch(join(bin, 'powershell.exe'));
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-Item -LiteralPath 'C:\\Edge\\msedge.exe').VersionInfo.ProductVersion"]), okResult('156.0.4314.42\r\n'));
    assert.equal(await browserVersion(runner, 'C:\\Edge\\msedge.exe', { PATH: bin }, 'win32', never), '156.0.4314.42');
    runner.assertAllUsed();
  });

  it('returns undefined when PowerShell is absent or fails on Windows', async () => {
    const runner = new FakeProcessRunner();
    assert.equal(await browserVersion(runner, 'C:\\Edge\\msedge.exe', {}, 'win32', never), undefined);
    const bin = join(root, 'bin2');
    touch(join(bin, 'powershell.exe'));
    runner.expect(matchProgram('powershell.exe'), failedResult(1, 'no such file'));
    assert.equal(await browserVersion(runner, 'C:\\Edge\\msedge.exe', { PATH: bin }, 'win32', never), undefined);
  });

  it('runs the browser with --version elsewhere', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('google-chrome', ['--version']), okResult('Google Chrome 156.0.8078.47\n'));
    assert.equal(await browserVersion(runner, '/usr/bin/google-chrome', {}, 'linux', never), '156.0.8078.47');
  });
});

describe('browserHint', () => {
  it('names the override variable on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) assert.match(browserHint(platform), /CHROME/);
  });
});
