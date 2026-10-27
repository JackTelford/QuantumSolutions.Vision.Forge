import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { blenderProbeArgs, blenderProbeExpression, parseBlenderProbe, probeTimeoutMs, runBlenderProbe } from '../../src/tools/blender-probe.ts';
import { findOnPath } from '../../src/tools/find-program.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

const goodLine = 'PROBE {"version_string": "5.2.3 LTS", "python": "3.13.5 (main, Jul 10 2026, 12:00:00) [MSC v.1943 64 bit (AMD64)]", "engines": ["BLENDER_EEVEE", "BLENDER_WORKBENCH", "CYCLES"], "compute_types": ["NONE", "CUDA", "OPTIX"], "devices": [["NVIDIA GeForce RTX 2060", "OPTIX"], ["AMD Ryzen 7", "CPU"]], "action_slots": true, "media_type": true}';

/** The Python inside exec("..."), with the escaped newlines turned back into real ones. */
const probeBody = blenderProbeExpression.slice('exec("'.length, -2).replace(/\\n/g, '\n');

/** A CPython on PATH, never the Microsoft Store alias under WindowsApps (a stub that opens the Store). */
function findPython(): string | undefined {
  for (const name of ['python', 'python3', 'py']) {
    const found = findOnPath(name);
    if (found !== undefined && !/[\\/]WindowsApps[\\/]/i.test(found)) return found;
  }
  return undefined;
}
const python = findPython();

describe('blenderProbeArgs', () => {
  it('runs in background with the factory configuration, no autoexec, no audio, exceptions exit 3, then the expression', () => {
    assert.deepEqual(blenderProbeArgs.slice(0, 7), ['-b', '--factory-startup', '--disable-autoexec', '-noaudio', '--python-exit-code', '3', '--python-expr']);
    assert.equal(blenderProbeArgs[7], blenderProbeExpression);
    assert.equal(blenderProbeArgs.length, 8);
    assert.equal(probeTimeoutMs, 120_000);
  });

  it('is one line of Python that probes every fact through bl_rna and prints one PROBE line', () => {
    assert.ok(!blenderProbeExpression.includes('\n'), 'no raw newline in the argument');
    assert.ok(blenderProbeExpression.startsWith('exec("') && blenderProbeExpression.endsWith('")'));
    for (const fragment of [
      'bpy.app.version_string',
      'sys.version',
      "bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items",
      'get_device_types(bpy.context)',
      'refresh_devices()',
      "'slots' in bpy.types.Action.bl_rna.properties",
      "'media_type' in bpy.types.ImageFormatSettings.bl_rna.properties",
      "print('PROBE ' + json.dumps(o))",
    ]) assert.ok(blenderProbeExpression.includes(fragment), fragment);
    assert.ok(!/hasattr/.test(blenderProbeExpression), 'hasattr never sees RNA properties (ADR 0004)');
  });

  it('has a body with no double quote and no backslash, so the exec string survives as one argument', () => {
    assert.ok(probeBody.split('\n').length >= 15);
    assert.ok(!probeBody.includes('"'), 'a double quote would end the exec string');
    assert.ok(!probeBody.includes('\\'), 'a backslash other than the newline escapes would change the Python');
  });

  it('parses as Python', { skip: python === undefined ? 'python is not on PATH' : false, timeout: 60_000 }, async () => {
    const runner = new ChildProcessRunner();
    const result = await runner.run({
      label: 'python',
      executable: python ?? '',
      args: ['-I', '-c', 'import ast, sys; ast.parse(sys.stdin.read())'],
      stdin: new TextEncoder().encode(probeBody),
      timeoutMs: 60_000,
    }, never);
    assert.equal(result.exitCode, 0, result.stderr);
  });
});

describe('parseBlenderProbe', () => {
  it('reads the PROBE line among other output and maps the device pairs', () => {
    const result = parseBlenderProbe(`Blender 5.2.3 LTS\nRead prefs\n${goodLine}\n\nBlender quit\n`);
    assert.ok(result.ok);
    assert.deepEqual(result.probe, {
      versionString: '5.2.3 LTS',
      python: '3.13.5 (main, Jul 10 2026, 12:00:00) [MSC v.1943 64 bit (AMD64)]',
      engines: ['BLENDER_EEVEE', 'BLENDER_WORKBENCH', 'CYCLES'],
      computeDeviceTypes: ['NONE', 'CUDA', 'OPTIX'],
      devices: [{ name: 'NVIDIA GeForce RTX 2060', type: 'OPTIX' }, { name: 'AMD Ryzen 7', type: 'CPU' }],
      actionSlots: true,
      mediaType: true,
    });
    assert.equal(result.warning, undefined);
  });

  it('explains a missing line, a non-JSON line and a line with the wrong shape', () => {
    const missing = parseBlenderProbe('Blender 5.2.3 LTS\nBlender quit\n');
    assert.ok(!missing.ok && /printed no PROBE line/.test(missing.problem));
    const notJson = parseBlenderProbe('PROBE {oops');
    assert.ok(!notJson.ok && /not JSON/.test(notJson.problem));
    const wrongShape = parseBlenderProbe('PROBE {"version_string": "5.2.3", "devices": "none"}');
    assert.ok(!wrongShape.ok && /without the expected fields/.test(wrongShape.problem));
    const notObject = parseBlenderProbe('PROBE [1, 2]');
    assert.ok(!notObject.ok && /not a JSON object/.test(notObject.problem));
  });
});

describe('runBlenderProbe', () => {
  it('returns the report when Blender exits 0 with the line', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender.exe', blenderProbeArgs), okResult(`${goodLine}\n`));
    const result = await runBlenderProbe(runner, 'C:\\Blender\\blender.exe', never);
    assert.ok(result.ok && result.probe.engines.includes('CYCLES'));
    assert.equal(result.warning, undefined);
    assert.equal(runner.invocations[0]?.timeoutMs, probeTimeoutMs);
  });

  it('keeps the report with a warning when Blender crashes at teardown after printing it (ADR 0004)', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender.exe', blenderProbeArgs), failedResult(3221225477, 'EXCEPTION_ACCESS_VIOLATION', `${goodLine}\n`));
    const result = await runBlenderProbe(runner, 'C:\\Blender\\blender.exe', never);
    assert.ok(result.ok, 'ok' in result && !result.ok ? result.problem : '');
    assert.ok(result.ok && result.probe.engines.includes('CYCLES'));
    assert.match(result.ok ? result.warning ?? '' : '', /printed its report but Blender then exited with code 3221225477 \(EXCEPTION_ACCESS_VIOLATION\)/);
  });

  it('turns exit 3 without a line into a problem that quotes the Python error', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender.exe'), failedResult(3, "Traceback (most recent call last):\n  File \"<string>\", line 1\nKeyError: 'cycles'\n"));
    const result = await runBlenderProbe(runner, 'C:\\Blender\\blender.exe', never);
    assert.ok(!result.ok);
    assert.match(result.problem, /raised a Python exception \(exit 3\): .*KeyError: 'cycles'/);
  });

  it('turns any other failure and a timeout into problems, never exceptions', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender'), failedResult(1, 'Error: cannot open display'));
    const failed = await runBlenderProbe(runner, '/usr/bin/blender', never);
    assert.ok(!failed.ok && /exited with code 1: Error: cannot open display/.test(failed.problem));
    runner.expect(matchProgram('blender'), { exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '', elapsedMs: 120_001, timedOut: true });
    const timedOut = await runBlenderProbe(runner, '/usr/bin/blender', never);
    assert.ok(!timedOut.ok && /did not finish within 120 s/.test(timedOut.problem));
    runner.expect(matchProgram('blender'), { exitCode: null, signal: 'SIGTERM', stdout: `${goodLine}\n`, stderr: '', elapsedMs: 120_001, timedOut: true });
    const timedOutWithLine = await runBlenderProbe(runner, '/usr/bin/blender', never);
    assert.ok(!timedOutWithLine.ok, 'a timeout is a failure even when the line was printed');
  });
});
