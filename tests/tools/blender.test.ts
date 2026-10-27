import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { blenderCommand, blenderInstallHint, blenderRegistryKeys, blenderVersion, describeUnsupportedBlender, findBlender, isSupportedBlenderVersion, isWindowsAppsPath, knownBlenderPaths, launcherToBlender, parseBlenderVersion, parseRegistryCommand, sha256OfFile, supportedBlenderSeries } from '../../src/tools/blender.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

function touch(path: string, content = ''): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return path;
}

/** An environment with no PATH and no System32, so reg.exe is not found unless a test puts one on PATH. */
function isolated(root: string, extra: Record<string, string> = {}): Record<string, string> {
  return { SystemRoot: join(root, 'no-windows'), ...extra };
}

describe('version gate', () => {
  it('parses the first line of blender --version and accepts only the 5.2 series', () => {
    assert.equal(parseBlenderVersion('Blender 5.2.3 LTS\n\tbuild date: 2026-10-22'), '5.2.3');
    assert.equal(parseBlenderVersion('Blender 4.5.15 LTS'), '4.5.15');
    assert.equal(parseBlenderVersion('Blender 5.3.0'), '5.3.0');
    assert.equal(parseBlenderVersion('not blender'), undefined);
    assert.equal(supportedBlenderSeries, '5.2');
    assert.equal(isSupportedBlenderVersion('5.2.3'), true);
    assert.equal(isSupportedBlenderVersion('5.2.0'), true);
    assert.equal(isSupportedBlenderVersion('4.5.15'), false);
    assert.equal(isSupportedBlenderVersion('5.3.0'), false);
    assert.equal(isSupportedBlenderVersion('5.20.1'), false);
  });

  it('names the exact install command per platform in the hint and the unsupported sentence', () => {
    assert.equal(blenderCommand('win32'), 'winget install --id BlenderFoundation.Blender --version 5.2.3 --exact');
    assert.equal(blenderCommand('darwin'), 'brew install --cask blender');
    assert.equal(blenderCommand('linux'), 'sudo snap install blender --classic (then confirm blender --version starts with 5.2)');
    assert.match(blenderInstallHint('win32'), /winget install --id BlenderFoundation\.Blender --version 5\.2\.3 --exact/);
    assert.match(blenderInstallHint('win32'), /BLENDER/);
    const sentence = describeUnsupportedBlender('4.5.15', 'C:\\Blender\\blender.exe', 'win32');
    assert.match(sentence, /Blender 4\.5\.15 at C:\\Blender\\blender\.exe is not supported; only 5\.2\.x is/);
    assert.match(sentence, /winget install --id BlenderFoundation\.Blender --version 5\.2\.3 --exact/);
    assert.match(describeUnsupportedBlender('5.3.0', '/snap/bin/blender', 'linux'), /sudo snap install blender --classic \(then confirm blender --version starts with 5\.2\)/);
  });

  it('reads the version through a runner and treats a failing Blender as no version', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender.exe', ['--version']), okResult('Blender 5.2.3 LTS\r\n\tbuild date: 2026-10-22\r\n'));
    assert.equal(await blenderVersion(runner, 'C:\\Blender\\blender.exe', never), '5.2.3');
    runner.expect(matchProgram('blender.exe', ['--version']), failedResult(1, 'crash'));
    assert.equal(await blenderVersion(runner, 'C:\\Blender\\blender.exe', never), undefined);
  });
});

describe('registry command parsing', () => {
  it('extracts the executable from a quoted command', () => {
    assert.equal(parseRegistryCommand('"C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender-launcher.exe" "%1"'), 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender-launcher.exe');
    assert.equal(parseRegistryCommand('C:\\Blender\\blender.exe "%1"'), 'C:\\Blender\\blender.exe');
    assert.equal(parseRegistryCommand(undefined), undefined);
    assert.equal(parseRegistryCommand('notepad'), undefined);
    assert.deepEqual(blenderRegistryKeys, ['HKLM\\SOFTWARE\\Classes\\blender.5.2\\shell\\open\\command', 'HKCU\\SOFTWARE\\Classes\\blender.5.2\\shell\\open\\command']);
  });

  it('swaps the launcher for blender.exe on any host, keeping the separators the registry used', () => {
    assert.equal(launcherToBlender('C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender-launcher.exe'), 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe');
    assert.equal(launcherToBlender('C:/Blender/blender-launcher.exe'), 'C:/Blender/blender.exe');
    assert.equal(launcherToBlender('D:\\Tools\\BLENDER-LAUNCHER.EXE'), 'D:\\Tools\\blender.exe');
    assert.equal(launcherToBlender('C:\\Blender\\blender.exe'), 'C:\\Blender\\blender.exe');
    assert.equal(launcherToBlender('/snap/bin/blender'), '/snap/bin/blender');
  });

  it('recognizes Microsoft Store paths', () => {
    assert.equal(isWindowsAppsPath('C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\blender.exe'), true);
    assert.equal(isWindowsAppsPath('C:\\Program Files\\WindowsApps\\BlenderFoundation.Blender_5.2\\blender.exe'), true);
    assert.equal(isWindowsAppsPath('C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'), false);
  });
});

describe('findBlender with a fake file tree', () => {
  let root = '';
  before(() => { root = mkdtempSync(join(tmpdir(), 'vf-blender-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  it('lists the install folders in ADR 0004 order plus the per-user folder', () => {
    assert.deepEqual(knownBlenderPaths({ ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\Local' }, 'win32'), [
      join('C:\\PF', 'Blender Foundation', 'Blender 5.2', 'blender.exe'),
      join('C:\\Local', 'Programs', 'Blender Foundation', 'Blender 5.2', 'blender.exe'),
    ]);
    assert.deepEqual(knownBlenderPaths({}, 'darwin'), ['/Applications/Blender.app/Contents/MacOS/Blender']);
    assert.deepEqual(knownBlenderPaths({}, 'linux'), ['/snap/bin/blender', '/usr/bin/blender', '/usr/local/bin/blender']);
  });

  it('prefers BLENDER, then Program Files, then the per-user folder, then PATH', async () => {
    const runner = new FakeProcessRunner();
    const override = touch(join(root, 'custom', 'blender.exe'));
    const machine = touch(join(root, 'pf', 'Blender Foundation', 'Blender 5.2', 'blender.exe'));
    const user = touch(join(root, 'local', 'Programs', 'Blender Foundation', 'Blender 5.2', 'blender.exe'));
    const onPath = touch(join(root, 'bin', 'blender.exe'));
    const env = isolated(root, { ProgramFiles: join(root, 'pf'), LOCALAPPDATA: join(root, 'local'), PATH: join(root, 'bin') });
    assert.deepEqual(await findBlender(runner, { ...env, BLENDER: override }, 'win32', never), { found: { path: override, foundBy: 'env' }, problems: [] });
    assert.deepEqual(await findBlender(runner, env, 'win32', never), { found: { path: machine, foundBy: 'known-folder' }, problems: [] });
    const withoutMachine = isolated(root, { LOCALAPPDATA: join(root, 'local'), PATH: join(root, 'bin') });
    assert.deepEqual(await findBlender(runner, withoutMachine, 'win32', never), { found: { path: user, foundBy: 'known-folder' }, problems: [] });
    assert.deepEqual(await findBlender(runner, isolated(root, { PATH: join(root, 'bin') }), 'win32', never), { found: { path: onPath, foundBy: 'path' }, problems: [] });
    assert.deepEqual(runner.invocations, []);
  });

  it('reads the ProgID command from the registry, HKLM before HKCU, whatever language labels the default value, and swaps the launcher for blender.exe', async () => {
    const regDir = join(root, 'reg');
    touch(join(regDir, 'reg.exe'));
    const installed = touch(join(root, 'registry-install', 'blender.exe'));
    const launcher = join(root, 'registry-install', 'blender-launcher.exe');
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('reg.exe', ['query', blenderRegistryKeys[0] ?? '', '/ve']), failedResult(1, 'ERROR: The system was unable to find the specified registry key or value.'));
    runner.expect(matchProgram('reg.exe', ['query', blenderRegistryKeys[1] ?? '', '/ve']), okResult(`\r\nHKEY_CURRENT_USER\\SOFTWARE\\Classes\\blender.5.2\\shell\\open\\command\r\n    (Standard)    REG_SZ    "${launcher}" "%1"\r\n\r\n`));
    const discovery = await findBlender(runner, isolated(root, { PATH: regDir }), 'win32', never);
    assert.deepEqual(discovery, { found: { path: installed, foundBy: 'registry' }, problems: [] });
    runner.assertAllUsed();
  });

  it('refuses a Microsoft Store build wherever it appears and says so', async () => {
    const runner = new FakeProcessRunner();
    const store = touch(join(root, 'WindowsApps', 'blender.exe'));
    const fromEnv = await findBlender(runner, isolated(root, { BLENDER: store }), 'win32', never);
    assert.equal(fromEnv.found, undefined);
    assert.match(fromEnv.problems[0] ?? '', /Microsoft Store build, which is not supported/);
    const fromPath = await findBlender(runner, isolated(root, { PATH: join(root, 'WindowsApps') }), 'win32', never);
    assert.equal(fromPath.found, undefined);
    assert.equal(fromPath.problems.length, 1);
  });

  it('reports an override that is not a runnable file and stops there', async () => {
    const runner = new FakeProcessRunner();
    const machine = touch(join(root, 'pf2', 'Blender Foundation', 'Blender 5.2', 'blender.exe'));
    const discovery = await findBlender(runner, isolated(root, { BLENDER: join(root, 'missing', 'blender.exe'), ProgramFiles: join(root, 'pf2') }), 'win32', never);
    assert.equal(discovery.found, undefined);
    assert.match(discovery.problems[0] ?? '', /BLENDER is set to .* which is not a runnable file/);
    assert.ok(machine.length > 0);
  });

  it('finds the known paths on macOS and Linux without touching the registry', async () => {
    const runner = new FakeProcessRunner();
    assert.deepEqual(await findBlender(runner, isolated(root), 'linux', never), { found: undefined, problems: [] });
    assert.deepEqual(runner.invocations, []);
  });
});

describe('sha256OfFile', () => {
  it('hashes a file by streaming it and rejects for a file that does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-sha-'));
    try {
      const path = touch(join(dir, 'blender.exe'), 'abc');
      assert.equal(await sha256OfFile(path), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      await assert.rejects(sha256OfFile(join(dir, 'missing.exe')), (error: unknown) => error instanceof Error && /ENOENT/.test(error.message));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
