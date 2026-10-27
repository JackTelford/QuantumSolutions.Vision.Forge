import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { interactiveSessionCommand, isInteractiveSession, longPathsKey, longPathsValueName, parsePowershellBoolean, readLongPathsEnabled } from '../../src/tools/session.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

/** Captured from `reg query HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled`. */
const longPathsOutput = '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\r\n    LongPathsEnabled    REG_DWORD    0x0\r\n\r\n';

describe('session facts', () => {
  let root = '';
  let bin = '';
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'vf-session-'));
    bin = join(root, 'bin');
    mkdirSync(bin);
    for (const file of ['powershell.exe', 'reg.exe']) writeFileSync(join(bin, file), '', 'utf8');
  });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  it('parses PowerShell booleans', () => {
    assert.equal(parsePowershellBoolean('True\r\n'), true);
    assert.equal(parsePowershellBoolean('false'), false);
    assert.equal(parsePowershellBoolean(''), undefined);
  });

  it('asks PowerShell on Windows and believes a False answer', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', interactiveSessionCommand]), okResult('False\r\n'));
    assert.equal(await isInteractiveSession(runner, { PATH: bin }, 'win32', never), false);
    runner.expect(matchProgram('powershell.exe'), okResult('True\r\n'));
    assert.equal(await isInteractiveSession(runner, { PATH: bin }, 'win32', never), true);
    runner.expect(matchProgram('powershell.exe'), failedResult(1, 'oops'));
    assert.equal(await isInteractiveSession(runner, { PATH: bin }, 'win32', never), true);
    assert.equal(await isInteractiveSession(new FakeProcessRunner(), { SystemRoot: root }, 'win32', never), true);
  });

  it('is always interactive on macOS and needs a display variable on Linux', async () => {
    const runner = new FakeProcessRunner();
    assert.equal(await isInteractiveSession(runner, {}, 'darwin', never), true);
    assert.equal(await isInteractiveSession(runner, {}, 'linux', never), false);
    assert.equal(await isInteractiveSession(runner, { DISPLAY: ':0' }, 'linux', never), true);
    assert.equal(await isInteractiveSession(runner, { WAYLAND_DISPLAY: 'wayland-0' }, 'linux', never), true);
    assert.deepEqual(runner.invocations, []);
  });

  it('reads LongPathsEnabled through reg.exe on Windows and reports null elsewhere or when unreadable', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('reg.exe', ['query', longPathsKey, '/v', longPathsValueName]), okResult(longPathsOutput));
    assert.equal(await readLongPathsEnabled(runner, { PATH: bin }, 'win32', never), false);
    runner.expect(matchProgram('reg.exe'), okResult(longPathsOutput.replace('0x0', '0x1')));
    assert.equal(await readLongPathsEnabled(runner, { PATH: bin }, 'win32', never), true);
    runner.expect(matchProgram('reg.exe'), failedResult(1, 'ERROR: The system was unable to find the specified registry key or value.'));
    assert.equal(await readLongPathsEnabled(runner, { PATH: bin }, 'win32', never), null);
    assert.equal(await readLongPathsEnabled(runner, {}, 'linux', never), null);
    assert.equal(await readLongPathsEnabled(new FakeProcessRunner(), { SystemRoot: root }, 'win32', never), null);
  });
});
