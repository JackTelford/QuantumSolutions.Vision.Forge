import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { detectGpu, parseNvidiaSmi, parseVideoController, videoControllerCommand } from '../../src/tools/gpu.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

describe('parseNvidiaSmi and parseVideoController', () => {
  it('split the nvidia-smi CSV line at its last comma so names with commas survive', () => {
    assert.deepEqual(parseNvidiaSmi('NVIDIA GeForce RTX 2060, 610.88\r\n'), { name: 'NVIDIA GeForce RTX 2060', driver: '610.88' });
    assert.deepEqual(parseNvidiaSmi('NVIDIA RTX A6000, Ada, 555.42'), { name: 'NVIDIA RTX A6000, Ada', driver: '555.42' });
    assert.equal(parseNvidiaSmi(''), undefined);
    assert.equal(parseNvidiaSmi('No devices were found'), undefined);
  });

  it('split the PowerShell line at the bar', () => {
    assert.deepEqual(parseVideoController('NVIDIA GeForce RTX 2060|32.0.16.1088\r\n'), { name: 'NVIDIA GeForce RTX 2060', driver: '32.0.16.1088' });
    assert.equal(parseVideoController('\r\n'), undefined);
    assert.equal(parseVideoController('no bar'), undefined);
    assert.match(videoControllerCommand, /Win32_VideoController/);
  });
});

describe('detectGpu', () => {
  let root = '';
  before(() => { root = mkdtempSync(join(tmpdir(), 'vf-gpu-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  function bin(name: string, files: readonly string[]): string {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    for (const file of files) writeFileSync(join(dir, file), '', 'utf8');
    return dir;
  }

  it('asks nvidia-smi first when it is on PATH', async () => {
    const path = bin('nvidia', ['nvidia-smi.exe', 'powershell.exe']);
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('nvidia-smi.exe', ['--query-gpu=name,driver_version', '--format=csv,noheader']), okResult('NVIDIA GeForce RTX 2060, 610.88\n'));
    assert.deepEqual(await detectGpu(runner, { PATH: path }, 'win32', never), { name: 'NVIDIA GeForce RTX 2060', driver: '610.88' });
    runner.assertAllUsed();
  });

  it('falls back to the first Win32_VideoController through PowerShell on Windows', async () => {
    const path = bin('ps', ['powershell.exe']);
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', videoControllerCommand]), okResult('Intel(R) UHD Graphics 630|31.0.101.2111\r\n'));
    assert.deepEqual(await detectGpu(runner, { PATH: path }, 'win32', never), { name: 'Intel(R) UHD Graphics 630', driver: '31.0.101.2111' });
  });

  it('falls through to PowerShell when nvidia-smi fails, and reports null when nothing answers', async () => {
    const path = bin('both', ['nvidia-smi.exe', 'powershell.exe']);
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('nvidia-smi.exe'), failedResult(9, 'NVIDIA-SMI has failed'));
    runner.expect(matchProgram('powershell.exe'), okResult(''));
    assert.equal(await detectGpu(runner, { PATH: path }, 'win32', never), null);
    assert.equal(await detectGpu(new FakeProcessRunner(), {}, 'linux', never), null);
    assert.equal(await detectGpu(new FakeProcessRunner(), {}, 'win32', never), null);
  });
});
