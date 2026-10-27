import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { findOnPath, isRunnableFile } from '../../src/tools/find-program.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const cmdPath = join(repoRoot, 'Setup-VisionForge.cmd');
const ps1Path = join(repoRoot, 'scripts', 'setup.ps1');
const shPath = join(repoRoot, 'scripts', 'setup.sh');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

const powershell = findOnPath('powershell');

/** Git's bash on Windows (never the WSL launcher in System32), or bash on PATH elsewhere. */
function findBash(): string | undefined {
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    return [join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'), join(programFiles, 'Git', 'bin', 'bash.exe')].find(isRunnableFile);
  }
  return findOnPath('bash');
}
const bash = findBash();

describe('Setup-VisionForge.cmd', () => {
  const text = readFileSync(cmdPath, 'utf8');

  it('uses CRLF line endings throughout', () => {
    assert.ok(!/(^|[^\r])\n/.test(text), 'a line ends with a bare LF');
    assert.ok(text.endsWith('\r\n'));
  });

  it('runs scripts\\setup.ps1 through powershell.exe without a profile, passes its arguments and pauses on error', () => {
    assert.ok(text.includes('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\setup.ps1" %*'), text);
    assert.match(text, /\r\n\s*pause\r\n/);
    assert.match(text, /exit \/b %EXITCODE%/);
  });
});

describe('scripts/setup.ps1', () => {
  const text = readFileSync(ps1Path, 'utf8');

  it('follows the PowerShell conventions and never asks for input', () => {
    assert.match(text, /^\[CmdletBinding\(\)\]\r?\nparam\(/m);
    assert.match(text, /\[switch\]\$Install/);
    assert.match(text, /\[switch\]\$CheckOnly/);
    assert.match(text, /\[string\]\$DataDir/);
    assert.match(text, /^Set-StrictMode -Version Latest$/m);
    assert.match(text, /^\$ErrorActionPreference = 'Stop'$/m);
    assert.doesNotMatch(text, /Read-Host/);
    for (const name of ['Find-VfNode', 'Find-VfFfmpeg', 'Find-VfBrowser', 'Find-VfBlender']) assert.match(text, new RegExp(`^function ${name}`, 'm'));
    assert.ok(!text.includes('\r'), 'LF line endings');
  });

  it('installs by exact winget id with a purpose, checks $LASTEXITCODE after native calls, then runs npm ci and doctor', () => {
    assert.match(text, /'OpenJS\.NodeJS\.LTS' 'Node\.js 24 to run the command-line program'/);
    assert.match(text, /'Gyan\.FFmpeg' 'ffmpeg to assemble and check video'/);
    assert.match(text, /'BlenderFoundation\.Blender' "Blender \$blenderSeries LTS for the blender lane \(optional; skipped with -SkipBlender\)" @\('--version', \$blenderVersion\)/);
    assert.match(text, /--id \$Id --exact/);
    assert.ok((text.match(/\$LASTEXITCODE/g) ?? []).length >= 6);
    assert.match(text, /ci --ignore-scripts/);
    assert.match(text, /'scripts\\cli\.ts'\) @doctorArguments/);
  });

  it('tells a user with an unsupported Blender that -Install leaves it alone', () => {
    assert.match(text, /-Install leaves an existing Blender alone\. Install \$blenderVersion by hand with: winget install --id BlenderFoundation\.Blender --version \$blenderVersion --exact/);
    assert.match(text, /the blender lane is off until it is installed \(Setup-VisionForge\.cmd -Install/);
  });

  it('parses as a script block', { skip: powershell === undefined ? 'powershell is not on PATH' : false }, async () => {
    const result = await runner.run({
      label: 'powershell',
      executable: powershell ?? '',
      args: ['-NoProfile', '-NonInteractive', '-Command', `[scriptblock]::Create((Get-Content -Raw '${ps1Path.replace(/'/g, "''")}')) | Out-Null; 'parsed'`],
      timeoutMs: 60_000,
    }, never);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /parsed/);
  });

  it('reports the programs in check-only mode without changing anything', { skip: powershell === undefined || process.platform !== 'win32' ? 'needs powershell on Windows' : false, timeout: 120_000 }, async () => {
    const result = await runner.run({ label: 'powershell', executable: powershell ?? '', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path, '-CheckOnly'], cwd: repoRoot, timeoutMs: 110_000 }, never);
    assert.ok(result.exitCode === 0 || result.exitCode === 1, `exit ${result.exitCode}: ${result.stderr}`);
    assert.match(result.stdout, /^Program\s+Found\s+Version\s+Path/m);
    assert.match(result.stdout, /^Node\.js 24\.12\+\s+yes/m);
    assert.match(result.stdout, /^Blender 5\.2 LTS \(optional\)/m);
    assert.doesNotMatch(result.stderr, /Exception|Error/);
  });
});

describe('scripts/setup.sh', () => {
  const text = readFileSync(shPath, 'utf8');

  it('is strict bash with an --install flag, never reads input itself and says that sudo may', () => {
    assert.ok(text.startsWith('#!/usr/bin/env bash\n'));
    assert.match(text, /^set -euo pipefail$/m);
    assert.match(text, /--install\) INSTALL=1/);
    assert.match(text, /--check-only\)/);
    assert.match(text, /--data-dir\)/);
    assert.doesNotMatch(text, /read -p/);
    assert.doesNotMatch(text, /^\s*read\b/m);
    assert.match(text, /--install calls sudo, which may ask for your password/);
    assert.ok(!text.includes('\r'), 'LF line endings');
  });

  it('names the platform install commands, installs the snap without a track and ends with npm ci and doctor', () => {
    for (const fragment of ['brew install node@24', 'brew install ffmpeg', 'brew install --cask blender', 'sudo apt-get install -y ffmpeg', 'sudo snap install blender --classic', 'npm ci --ignore-scripts', 'scripts/cli.ts doctor']) {
      assert.ok(text.includes(fragment), fragment);
    }
    assert.doesNotMatch(text, /--channel=/, 'the blender snap has no 5.2 track');
    assert.match(text, /nodesource|nvm/i);
  });

  it('tells a user with an unsupported Blender that --install leaves it alone', () => {
    assert.match(text, /--install leaves an existing Blender alone\. Install \$\{BLENDER_SERIES\} LTS by hand with: \$BLENDER_HINT/);
    assert.match(text, /the blender lane is off until it is installed \(scripts\/setup\.sh --install/);
  });

  it('passes bash -n', { skip: bash === undefined ? 'bash is not installed' : false }, async () => {
    const result = await runner.run({ label: 'bash', executable: bash ?? '', args: ['-n', shPath], timeoutMs: 60_000 }, never);
    assert.equal(result.exitCode, 0, result.stderr);
  });

  it('reports the programs in check-only mode on macOS and Linux', { skip: bash === undefined || process.platform === 'win32' ? 'needs bash on macOS or Linux' : false, timeout: 120_000 }, async () => {
    const result = await runner.run({ label: 'bash', executable: bash ?? '', args: [shPath, '--check-only'], cwd: repoRoot, timeoutMs: 110_000 }, never);
    assert.ok(result.exitCode === 0 || result.exitCode === 1, `exit ${result.exitCode}: ${result.stderr}`);
    assert.match(result.stdout, /^Program\s+Found\s+Version\s+Path/m);
  });
});
