import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { BlenderRenderError, BlenderScriptError, BlenderTimeoutError } from '../../../src/errors/blender-errors.ts';
import { blackFrameYavg, checkFrames, crashLogIsNew, crashLogMtime, crashLogPath, judgeBlenderRun, measureFrameYavg, teardownCrashExitCode, verdictError } from '../../../src/lanes/blender/success.ts';
import type { JudgeInputs } from '../../../src/lanes/blender/success.ts';
import { ChildProcessRunner } from '../../../src/process/child-process-runner.ts';
import type { ProcessResult, ProcessRunner, ProcessSpec } from '../../../src/process/process-runner.ts';
import { findFfmpeg } from '../../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../../fakes/fake-process-runner.ts';
import { writeSolidPng } from '../../fakes/png.ts';

const never = new AbortController().signal;
const ffmpeg = findFfmpeg();

/** A side effect that writes the signalstats print file named in the -vf argument with one YAVG. */
function printsYavg(yavg: number): (spec: ProcessSpec) => void {
  return (spec: ProcessSpec): void => {
    const filter = spec.args[spec.args.indexOf('-vf') + 1] ?? '';
    const match = /file='([^']+)'/.exec(filter);
    assert.ok(match !== null, `no stats file in ${filter}`);
    writeFileSync(match[1]!.replace(/\\:/g, ':'), `frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=${yavg}\n`, 'utf8');
  };
}

describe('crash log', () => {
  it('lives under TEMP on Windows and under /tmp elsewhere', () => {
    assert.equal(crashLogPath('win32', { TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp' }), join('C:\\Users\\me\\AppData\\Local\\Temp', 'blender.crash.txt'));
    assert.equal(crashLogPath('win32', { TMP: 'D:\\tmp' }), join('D:\\tmp', 'blender.crash.txt'));
    assert.equal(crashLogPath('linux', {}), '/tmp/blender.crash.txt');
    assert.equal(crashLogPath('darwin', {}), '/tmp/blender.crash.txt');
  });
});

describe('judgeBlenderRun', () => {
  let dir = '';
  let spawnedAt = 0;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-blender-judge-'));
    spawnedAt = Date.now();
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  /** Writes the frames of a batch now (after spawnedAt) and returns their paths. */
  function freshFrames(name: string, count: number, colour: readonly [number, number, number] = [120, 120, 120]): string[] {
    const paths: string[] = [];
    for (let frame = 0; frame < count; frame += 1) {
      const path = join(dir, name, `f${String(frame).padStart(6, '0')}.png`);
      writeSolidPng(path, 8, 8, colour);
      paths.push(path);
    }
    return paths;
  }

  function inputs(result: ProcessResult, expectedFrames: readonly string[], runner: ProcessRunner, changes: Partial<JudgeInputs> = {}): JudgeInputs {
    return { result, expectedFrames, spawnedAt, crashLogPath: join(dir, 'no-crash.txt'), crashLogMtimeBefore: undefined, runner, ffmpegPath: 'C:\\tools\\ffmpeg.exe', statsPath: join(dir, 'yavg.txt'), signal: never, ...changes };
  }

  it('is ok for exit 0 with every frame present, lit, and no crash log', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(96.5));
    const verdict = await judgeBlenderRun(inputs(okResult(), freshFrames('ok', 2), runner));
    assert.deepEqual(verdict, { ok: true });
    const spec = runner.invocations[0];
    assert.match(spec?.args.join(' ') ?? '', /scale=out_color_matrix=bt709,format=yuv420p,signalstats/);
    assert.equal(spec?.args[spec.args.indexOf('-i') + 1], join(dir, 'ok', 'f000000.png'), 'the first frame is measured');
  });

  it('tolerates the documented teardown crash exit code when every frame was written after the spawn', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(80));
    const verdict = await judgeBlenderRun(inputs(failedResult(teardownCrashExitCode, 'EXCEPTION_ACCESS_VIOLATION'), freshFrames('crash', 2), runner));
    assert.deepEqual(verdict, { ok: true });
  });

  it('fails with blender-script on exit 3 before looking at any file', async () => {
    const runner = new FakeProcessRunner();
    const verdict = await judgeBlenderRun(inputs(failedResult(3, 'Traceback (most recent call last):\n  KeyError: \'lights\''), freshFrames('script', 1), runner));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.code, 'blender-script');
    assert.match(verdict.stderrTail, /KeyError/);
    assert.equal(runner.invocations.length, 0);
  });

  it('fails with blender-render on exit 1 with the stderr tail', async () => {
    const verdict = await judgeBlenderRun(inputs(failedResult(1, 'Error: Cannot render, no camera'), freshFrames('exit1', 1), new FakeProcessRunner()));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.code, 'blender-render');
    assert.match(verdict.reason, /exited with code 1/);
    assert.match(verdict.stderrTail, /no camera/);
  });

  it('fails with blender-render when a frame is missing, even on exit 0 (some pre-render failures exit 0 with no file)', async () => {
    const present = freshFrames('missing', 1);
    const verdict = await judgeBlenderRun(inputs(okResult(), [...present, join(dir, 'missing', 'f000001.png')], new FakeProcessRunner()));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.code, 'blender-render');
    assert.match(verdict.reason, /1 of 2 frame\(s\) were not written/);
  });

  it('fails with blender-render on the teardown crash code when a frame is older than the spawn', async () => {
    const frames = freshFrames('stale', 1);
    const old = new Date(spawnedAt - 60_000);
    utimesSync(frames[0]!, old, old);
    assert.deepEqual(checkFrames(frames, spawnedAt), { missing: [], stale: frames });
    const verdict = await judgeBlenderRun(inputs(failedResult(teardownCrashExitCode, ''), frames, new FakeProcessRunner()));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.reason, /written before this run started/);
  });

  it('fails with blender-render when the first frame is black', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(blackFrameYavg));
    const verdict = await judgeBlenderRun(inputs(okResult(), freshFrames('black', 1, [0, 0, 0]), runner));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.code, 'blender-render');
    assert.equal(blackFrameYavg, 18, 'black is 16 in the limited range signalstats reads; two above it is still black');
    assert.match(verdict.reason, /is black \(YAVG 18\.0\)/);
  });

  it('fails with blender-render when signalstats prints nothing for the first frame', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult());
    const verdict = await judgeBlenderRun(inputs(okResult(), freshFrames('unreadable', 1), runner, { statsPath: join(dir, 'never-written.txt') }));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.reason, /printed no luma/);
  });

  it('fails with blender-render, not with ffmpeg\'s own error, when the first frame does not decode (a PNG Blender did not finish writing)', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), failedResult(1, 'Invalid PNG signature'));
    const verdict = await judgeBlenderRun(inputs(okResult(), freshFrames('truncated', 1), runner, { statsPath: join(dir, 'truncated.txt') }));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.code, 'blender-render');
    assert.match(verdict.reason, /printed no luma .* not a readable PNG/);
  });

  it('fails with blender-render when a crash log appeared since the spawn, and not when an old one sits there', async () => {
    const crashLog = join(dir, 'blender.crash.txt');
    writeFileSync(crashLog, 'old crash', 'utf8');
    const old = new Date(spawnedAt - 60_000);
    utimesSync(crashLog, old, old);
    const before = crashLogMtime(crashLog);
    assert.ok(before !== undefined);
    assert.equal(crashLogIsNew(crashLog, before), false);
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(90));
    assert.deepEqual(await judgeBlenderRun(inputs(okResult(), freshFrames('oldlog', 1), runner, { crashLogPath: crashLog, crashLogMtimeBefore: before })), { ok: true });

    writeFileSync(crashLog, 'fresh crash', 'utf8');
    assert.equal(crashLogIsNew(crashLog, before), true);
    assert.equal(crashLogIsNew(crashLog, undefined), true);
    const verdict = await judgeBlenderRun(inputs(okResult(), freshFrames('newlog', 1), new FakeProcessRunner(), { crashLogPath: crashLog, crashLogMtimeBefore: before }));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.code, 'blender-render');
    assert.match(verdict.reason, /crash log/);
    assert.equal(crashLogMtime(join(dir, 'absent.txt')), undefined);
  });

  it('fails with blender-timeout when the runner stopped Blender', async () => {
    const result: ProcessResult = { exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '', elapsedMs: 90_000, timedOut: true };
    const verdict = await judgeBlenderRun(inputs(result, freshFrames('timeout', 1), new FakeProcessRunner()));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.code, 'blender-timeout');
  });

  it('turns each failure into its error class with the code, the scene path and the tail', () => {
    const scenePath = 'C:\\vf\\scene.json';
    const script = verdictError({ ok: false, code: 'blender-script', reason: 'x', stderrTail: 'KeyError' }, scenePath, 90_000);
    assert.ok(script instanceof BlenderScriptError);
    assert.equal(script.code, 'blender-script');
    assert.match(script.message, /apply_scene\.py raised .* C:\\vf\\scene\.json.*KeyError/);
    const render = verdictError({ ok: false, code: 'blender-render', reason: 'the first frame is black.', stderrTail: '' }, scenePath, 90_000);
    assert.ok(render instanceof BlenderRenderError);
    assert.equal(render.reason, 'the first frame is black.');
    assert.match(render.hint, /ladder/);
    const timeout = verdictError({ ok: false, code: 'blender-timeout', reason: '', stderrTail: '' }, scenePath, 90_000);
    assert.ok(timeout instanceof BlenderTimeoutError);
    assert.equal(timeout.timeoutMs, 90_000);
    assert.match(timeout.message, /within 90 s/);
  });
});

describe('measureFrameYavg with the installed ffmpeg', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-blender-yavg-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads a black frame at or below the threshold and a gray one well above it', async () => {
    if (ffmpeg === undefined) return;
    const runner = new ChildProcessRunner();
    const black = join(dir, 'black.png');
    const gray = join(dir, 'gray.png');
    writeSolidPng(black, 16, 16, [0, 0, 0]);
    writeSolidPng(gray, 16, 16, [118, 118, 118]);
    const blackYavg = await measureFrameYavg(runner, ffmpeg.path, black, join(dir, 'black.txt'), never);
    const grayYavg = await measureFrameYavg(runner, ffmpeg.path, gray, join(dir, 'gray.txt'), never);
    assert.ok(blackYavg !== undefined && blackYavg <= blackFrameYavg, `black ${String(blackYavg)}`);
    assert.ok(grayYavg !== undefined && grayYavg > 100, `gray ${String(grayYavg)}`);
  });
});
