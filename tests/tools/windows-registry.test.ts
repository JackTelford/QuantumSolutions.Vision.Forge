import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findRegExe, parseDword, parseRegistryValues, readRegistryValue } from '../../src/tools/windows-registry.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

const longPathsKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem';
/** Captured from `reg query HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled`. */
const longPathsOutput = `\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\r\n    LongPathsEnabled    REG_DWORD    0x0\r\n\r\n`;

const progIdKey = 'HKLM\\SOFTWARE\\Classes\\blender.5.2\\shell\\open\\command';
const launcherCommand = '"C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender-launcher.exe" "%1"';
/** Captured from `reg query <key> /ve` on English Windows. */
const englishDefault = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\blender.5.2\\shell\\open\\command\r\n    (Default)    REG_SZ    ${launcherCommand}\r\n\r\n`;
/** The same query on German Windows: reg.exe localizes the label of the default value. */
const germanDefault = englishDefault.replace('(Default)', '(Standard)');

describe('parseRegistryValues and parseDword', () => {
  it('read value lines with their type and data, including default values and data with spaces', () => {
    assert.deepEqual(parseRegistryValues(longPathsOutput), [{ name: 'LongPathsEnabled', type: 'REG_DWORD', data: '0x0' }]);
    assert.deepEqual(parseRegistryValues(englishDefault), [{ name: '(Default)', type: 'REG_SZ', data: launcherCommand }]);
    assert.deepEqual(parseRegistryValues(germanDefault), [{ name: '(Standard)', type: 'REG_SZ', data: launcherCommand }]);
    assert.deepEqual(parseRegistryValues('    Empty    REG_SZ\r\n'), [{ name: 'Empty', type: 'REG_SZ', data: '' }]);
  });

  it('turn REG_DWORD data into numbers', () => {
    assert.equal(parseDword('0x0'), 0);
    assert.equal(parseDword('0x1'), 1);
    assert.equal(parseDword('0x78'), 120);
    assert.equal(parseDword('2'), undefined);
    assert.equal(parseDword(undefined), undefined);
  });
});

describe('findRegExe', () => {
  it('finds reg.exe only on Windows, on PATH or under SystemRoot', () => {
    assert.equal(findRegExe({}, 'linux'), undefined);
    const root = mkdtempSync(join(tmpdir(), 'vf-reg-'));
    try {
      assert.equal(findRegExe({ SystemRoot: root }, 'win32'), undefined);
      mkdirSync(join(root, 'System32'));
      writeFileSync(join(root, 'System32', 'reg.exe'), '', 'utf8');
      assert.equal(findRegExe({ SystemRoot: root }, 'win32'), join(root, 'System32', 'reg.exe'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('readRegistryValue', () => {
  let root = '';
  let bin = '';
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'vf-registry-'));
    bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'reg.exe'), '', 'utf8');
  });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  it('takes the default value by position, whatever language reg.exe labels it in', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('reg.exe', ['query', progIdKey, '/ve']), okResult(germanDefault));
    assert.equal(await readRegistryValue(runner, progIdKey, undefined, { PATH: bin }, 'win32', never), launcherCommand);
    runner.expect(matchProgram('reg.exe', ['query', progIdKey, '/ve']), okResult(englishDefault));
    assert.equal(await readRegistryValue(runner, progIdKey, undefined, { PATH: bin }, 'win32', never), launcherCommand);
    runner.assertAllUsed();
    assert.ok(runner.invocations.every((spec) => spec.label === 'reg' && spec.timeoutMs === 15_000));
  });

  it('matches a named value case-insensitively and ignores a line with another name', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('reg.exe', ['query', longPathsKey, '/v', 'longpathsenabled']), okResult(longPathsOutput.replace('0x0', '0x1')));
    assert.equal(await readRegistryValue(runner, longPathsKey, 'longpathsenabled', { PATH: bin }, 'win32', never), '0x1');
    runner.expect(matchProgram('reg.exe', ['query', longPathsKey, '/v', 'LongPathsEnabled']), okResult('    Other    REG_DWORD    0x1\r\n'));
    assert.equal(await readRegistryValue(runner, longPathsKey, 'LongPathsEnabled', { PATH: bin }, 'win32', never), undefined);
    runner.assertAllUsed();
  });

  it('returns undefined off Windows, without reg.exe, for a missing key and for a timed-out query', async () => {
    const runner = new FakeProcessRunner();
    assert.equal(await readRegistryValue(runner, progIdKey, undefined, { PATH: bin }, 'linux', never), undefined);
    assert.equal(await readRegistryValue(runner, progIdKey, undefined, { SystemRoot: join(root, 'no-windows') }, 'win32', never), undefined);
    assert.deepEqual(runner.invocations, []);
    runner.expect(matchProgram('reg.exe'), failedResult(1, 'ERROR: The system was unable to find the specified registry key or value.'));
    assert.equal(await readRegistryValue(runner, progIdKey, undefined, { PATH: bin }, 'win32', never), undefined);
    runner.expect(matchProgram('reg.exe'), { exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '', elapsedMs: 15_001, timedOut: true });
    assert.equal(await readRegistryValue(runner, progIdKey, undefined, { PATH: bin }, 'win32', never), undefined);
    runner.assertAllUsed();
  });
});
