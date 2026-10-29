import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../../src/cli/logger.ts';
import { InvalidExecutableError } from '../../../src/errors/vision-forge-error.ts';
import { repositoryRoot } from '../../../src/harness/served-roots.ts';
import { applierPath, batchTimeoutMs, blenderArgs, blenderUserResourcesDir, gpuPreflightExpression, isBlenderExecutable, runBlender } from '../../../src/lanes/blender/runner.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../../fakes/fake-process-runner.ts';

const never = new AbortController().signal;
const scenePath = 'C:\\vf\\cache\\k\\scene\\eevee-opengl\\scene.json';
const outDir = 'C:/vf/cache/k/frames';

describe('blenderArgs', () => {
  it('builds exactly the ADR 0004 argument list for an EEVEE attempt, backend and gpu.init() preflight included', () => {
    assert.deepEqual(blenderArgs({ backend: 'opengl', eevee: true, scenePath, outDir }), [
      '-b', '--factory-startup', '--disable-autoexec', '-noaudio', '--offline-mode', '--gpu-backend', 'opengl', '--python-exit-code', '3',
      '--python-expr', gpuPreflightExpression, '-P', applierPath, '--', scenePath, outDir,
    ]);
    assert.equal(blenderArgs({ backend: 'vulkan', eevee: true, scenePath, outDir })[6], 'vulkan');
  });

  it('leaves the GPU backend and the preflight out of a Cycles attempt, which needs no GPU context', () => {
    assert.deepEqual(blenderArgs({ backend: null, eevee: false, scenePath, outDir }), [
      '-b', '--factory-startup', '--disable-autoexec', '-noaudio', '--offline-mode', '--python-exit-code', '3', '-P', applierPath, '--', scenePath, outDir,
    ]);
  });

  it('refuses an EEVEE attempt without a backend and names the one Python file by absolute path', () => {
    assert.throws(() => blenderArgs({ backend: null, eevee: true, scenePath, outDir }), RangeError);
    assert.equal(applierPath, join(repositoryRoot, 'blender', 'apply_scene.py'));
    assert.ok(existsSync(applierPath), 'the applier is in the repository');
  });

  it('puts --python-exit-code before -P, since Blender applies it in command-line order', () => {
    const args = blenderArgs({ backend: null, eevee: false, scenePath, outDir });
    assert.ok(args.indexOf('--python-exit-code') < args.indexOf('-P'));
  });
});

describe('batchTimeoutMs', () => {
  it('gives 60 s plus 30 s per 1080p frame, scaled by the frame\'s pixels', () => {
    assert.equal(batchTimeoutMs(1, 1920, 1080), 90_000);
    assert.equal(batchTimeoutMs(30, 1920, 1080), 960_000);
    assert.equal(batchTimeoutMs(2, 960, 540), 75_000);
    assert.equal(batchTimeoutMs(1, 3840, 2160), 180_000);
  });

  it('takes another per-frame allowance for the CPU rung', () => {
    assert.equal(batchTimeoutMs(1, 1920, 1080, 300), 360_000);
    assert.equal(batchTimeoutMs(1, 64, 36, 300), Math.round((60 + 300 * ((64 * 36) / (1920 * 1080))) * 1000));
  });
});

describe('isBlenderExecutable', () => {
  it('accepts blender.exe and blender, never the launcher or anything else', () => {
    assert.equal(isBlenderExecutable('C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'), true);
    assert.equal(isBlenderExecutable('/snap/bin/blender'), true);
    assert.equal(isBlenderExecutable('C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender-launcher.exe'), false);
    assert.equal(isBlenderExecutable('C:\\tools\\blender.cmd'), false);
  });
});

describe('runBlender', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-blender-runner-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('spawns blender.exe with the arguments, the frames directory as cwd, the time limit and BLENDER_USER_RESOURCES under the data directory', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender.exe'), okResult('Saved: f000000.png'));
    const args = blenderArgs({ backend: null, eevee: false, scenePath, outDir });
    const result = await runBlender({ runner, executable: 'C:\\Blender\\blender.exe', args, dataDir: dir, cwd: outDir, timeoutMs: 90_000, signal: never, log: new MemoryLogger() });
    assert.equal(result.exitCode, 0);
    const spec = runner.invocations[0];
    assert.ok(spec !== undefined);
    assert.equal(spec.label, 'blender');
    assert.deepEqual(spec.args, args);
    assert.equal(spec.cwd, outDir);
    assert.equal(spec.timeoutMs, 90_000);
    assert.deepEqual(spec.env, { BLENDER_USER_RESOURCES: blenderUserResourcesDir(dir) });
    assert.equal(blenderUserResourcesDir(dir), join(dir, 'blender-user'));
    assert.ok(existsSync(blenderUserResourcesDir(dir)), 'the user resources folder exists before Blender starts');
    runner.assertAllUsed();
  });

  it('refuses blender-launcher.exe before spawning anything', async () => {
    const runner = new FakeProcessRunner();
    await assert.rejects(
      runBlender({ runner, executable: 'C:\\Blender\\blender-launcher.exe', args: [], dataDir: dir, cwd: outDir, timeoutMs: 1000, signal: never, log: new MemoryLogger() }),
      (error: unknown) => error instanceof InvalidExecutableError && /blender-launcher\.exe/.test(error.message),
    );
    assert.equal(runner.invocations.length, 0);
  });

  it('mirrors the output to the named log files', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender.exe'), okResult());
    await runBlender({ runner, executable: 'C:\\Blender\\blender.exe', args: [], dataDir: dir, cwd: outDir, timeoutMs: 1000, signal: never, log: new MemoryLogger(), stdoutFile: join(dir, 'out.log'), stderrFile: join(dir, 'err.log') });
    assert.equal(runner.invocations[0]?.stdoutFile, join(dir, 'out.log'));
    assert.equal(runner.invocations[0]?.stderrFile, join(dir, 'err.log'));
  });
});
