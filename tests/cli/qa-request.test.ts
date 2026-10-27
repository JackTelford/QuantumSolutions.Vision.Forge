import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { parseArguments } from '../../src/cli/arguments.ts';
import type { CommandContext } from '../../src/cli/command.ts';
import { command, defaultReportPath, parseRequest, runChecks } from '../../src/cli/commands/qa.ts';
import type { QaRequest } from '../../src/cli/commands/qa.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { DataFileError, SchemaValidationError, UsageError } from '../../src/errors/vision-forge-error.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { never, planFor } from '../qa/synthetic-clips.ts';

const whiteBox = { frame: 0, box: { x: 0.1, y: 0.2, w: 0.4, h: 0.4 }, textColor: '#000000' };
const videoJson = { streams: [{ codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p', r_frame_rate: '30/1', nb_read_frames: '60' }] };
const noStreams = JSON.stringify({ streams: [] });

function contextFor(dir: string, runner: FakeProcessRunner): CommandContext {
  return { dataDir: join(dir, 'data'), outDir: join(dir, 'out'), cwd: dir, runner, signal: never, log: new MemoryLogger(), now: () => new Date('2026-10-26T20:00:00.000Z') };
}

function requestFor(dir: string, argv: readonly string[]): QaRequest {
  return parseRequest(contextFor(dir, new FakeProcessRunner()), parseArguments(argv, command.options));
}

function usageError(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof UsageError && pattern.test(error.message);
}

describe('qa parseRequest', () => {
  let dir = '';
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-qa-request-'));
    writeFileSync(join(dir, 'film.mp4'), 'not really a video', 'utf8');
    writeFileSync(join(dir, 'hero.png'), 'not really a png', 'utf8');
    writeFileSync(join(dir, 'boxes.json'), JSON.stringify([whiteBox]), 'utf8');
    const plan = planFor([{ id: 'a', frames: 30 }, { id: 'b', frames: 15 }, { id: 'c', frames: 60 }]);
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan), 'utf8');
    writeFileSync(join(dir, 'plan-audio.json'), JSON.stringify({ ...plan, audio: { narration: [], music: null, loudnessLufs: -14, truePeakDbtp: -1.5 } }), 'utf8');
    writeFileSync(join(dir, 'plan-odd.json'), JSON.stringify({ ...plan, width: 321 }), 'utf8');
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('resolves the video against cwd and defaults everything else', () => {
    const request = requestFor(dir, ['--video', 'film.mp4']);
    assert.equal(request.videoPath, join(dir, 'film.mp4'));
    assert.equal(request.reportPath, defaultReportPath(join(dir, 'out'), request.videoPath));
    assert.equal(request.reportPath, join(dir, 'out', 'qa', 'film.qa.json'));
    assert.deepEqual([request.plan, request.textBoxes, request.still], [undefined, undefined, undefined]);
    assert.deepEqual([request.loudnessTarget, request.truePeakCeiling, request.noFail], [-16, -1, false]);
  });

  it('resolves --report against cwd and carries --no-fail', () => {
    const request = requestFor(dir, ['--video', 'film.mp4', '--report', 'reports/film.json', '--no-fail']);
    assert.equal(request.reportPath, join(dir, 'reports', 'film.json'));
    assert.equal(request.noFail, true);
  });

  it('needs --video and an existing video file', () => {
    assert.throws(() => requestFor(dir, []), usageError(/Missing --video/));
    assert.throws(() => requestFor(dir, ['--video', 'missing.mp4']), (error: unknown) => error instanceof DataFileError && error.path === join(dir, 'missing.mp4'));
  });

  it('takes --still and --still-frame only as a pair', () => {
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--still-frame', '3']), usageError(/^--still-frame needs --still\.$/));
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--still', 'hero.png']), usageError(/^--still needs --still-frame\.$/));
    const request = requestFor(dir, ['--video', 'film.mp4', '--still', 'hero.png', '--still-frame', '12']);
    assert.deepEqual(request.still, { path: join(dir, 'hero.png'), frame: 12 });
  });

  it('rejects a --still-frame that is not a frame number of 0 or more', () => {
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--still', 'hero.png', '--still-frame', '-1']), usageError(/0 or more, got -1/));
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--still', 'hero.png', '--still-frame', '1.5']), usageError(/0 or more, got 1\.5/));
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--still', 'hero.png', '--still-frame', 'ten']), usageError(/must be a number/));
    assert.equal(requestFor(dir, ['--video', 'film.mp4', '--still', 'hero.png', '--still-frame', '0']).still?.frame, 0);
  });

  it('reports a missing still or text-boxes file as a data-file error', () => {
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--still', 'nope.png', '--still-frame', '0']), DataFileError);
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--text-boxes', 'nope.json']), DataFileError);
  });

  it('reads the text boxes file', () => {
    assert.deepEqual(requestFor(dir, ['--video', 'film.mp4', '--text-boxes', 'boxes.json']).textBoxes, [whiteBox]);
  });

  it('loads the plan through the schema and the semantic checks', () => {
    const request = requestFor(dir, ['--video', 'film.mp4', '--plan', 'plan.json']);
    assert.equal(request.plan?.totalFrames, 105);
    assert.deepEqual(request.plan?.cutFrames, [0, 30, 45]);
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--plan', 'plan-odd.json']), (error: unknown) => error instanceof SchemaValidationError && /even/.test(error.message));
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--plan', 'missing.json']), DataFileError);
  });

  it('takes the loudness target from the flag, then the plan, then -16, and the true-peak ceiling from the plan, else -1', () => {
    const plain = requestFor(dir, ['--video', 'film.mp4', '--plan', 'plan.json']);
    assert.deepEqual([plain.loudnessTarget, plain.truePeakCeiling], [-16, -1]);
    const planned = requestFor(dir, ['--video', 'film.mp4', '--plan', 'plan-audio.json']);
    assert.deepEqual([planned.loudnessTarget, planned.truePeakCeiling], [-14, -1.5]);
    const flagged = requestFor(dir, ['--video', 'film.mp4', '--plan', 'plan-audio.json', '--loudness-target', '-23']);
    assert.deepEqual([flagged.loudnessTarget, flagged.truePeakCeiling], [-23, -1.5]);
    assert.equal(requestFor(dir, ['--video', 'film.mp4', '--loudness-target', '-20']).loudnessTarget, -20);
    assert.throws(() => requestFor(dir, ['--video', 'film.mp4', '--loudness-target', 'loud']), usageError(/--loudness-target must be a number/));
  });
});

/** Runs `work` with os.tmpdir() pointing at a fresh private directory, so only this run creates anything under it. */
async function withPrivateTempRoot<T>(work: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'vf-qa-root-'));
  const names = ['TMPDIR', 'TMP', 'TEMP'] as const;
  const saved = names.map((name) => process.env[name]);
  try {
    for (const name of names) process.env[name] = root;
    assert.equal(tmpdir(), root);
    return await work(root);
  } finally {
    names.forEach((name, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
    rmSync(root, { recursive: true, force: true });
  }
}

function workDirs(root: string): string[] {
  return readdirSync(root).filter((name) => name.startsWith('vf-qa-')).sort();
}

describe('qa runChecks', () => {
  let dir = '';
  let request: QaRequest;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-qa-run-'));
    writeFileSync(join(dir, 'film.mp4'), 'not really a video', 'utf8');
    request = requestFor(dir, ['--video', 'film.mp4']);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('removes its work directory after a run that completes', async () => {
    await withPrivateTempRoot(async (root) => {
      const fake = new FakeProcessRunner();
      let seenDuringRun: string[] = [];
      fake.expect(matchProgram('ffprobe.exe'), okResult(JSON.stringify(videoJson)));
      fake.expect(matchProgram('ffmpeg.exe'), okResult(), () => { seenDuringRun = workDirs(root); });
      for (let run = 0; run < 3; run += 1) fake.expect(matchProgram('ffmpeg.exe'), okResult());
      fake.expect(matchProgram('ffprobe.exe'), okResult(noStreams));
      const before = workDirs(root);
      const checks = await runChecks(contextFor(dir, fake), request, 'C:\\tools\\ffmpeg.exe', 'C:\\tools\\ffprobe.exe');
      assert.deepEqual(checks.map((check) => check.id), ['dimensions', 'fps', 'duration', 'black-frames', 'frozen-frames', 'pops', 'exposure-drift', 'loudness', 'true-peak']);
      assert.equal(seenDuringRun.length, 1, 'the run keeps one vf-qa-* work directory while the checks run');
      assert.deepEqual(before, []);
      assert.deepEqual(workDirs(root), before);
      assert.equal(existsSync(join(root, seenDuringRun[0] ?? '')), false);
      fake.assertAllUsed();
    });
  });

  it('removes its work directory when a check rejects', async () => {
    await withPrivateTempRoot(async (root) => {
      const fake = new FakeProcessRunner();
      fake.expect(matchProgram('ffprobe.exe'), okResult(JSON.stringify(videoJson)));
      const before = workDirs(root);
      await assert.rejects(runChecks(contextFor(dir, fake), request, 'C:\\tools\\ffmpeg.exe', 'C:\\tools\\ffprobe.exe'), /Unexpected process run/);
      assert.deepEqual(workDirs(root), before);
      assert.equal(fake.invocations.length, 2);
    });
  });
});
