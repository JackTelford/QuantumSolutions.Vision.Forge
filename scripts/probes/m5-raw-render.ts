/**
 * One Blender run at a time for the acceptance probe: the scene document
 * of one frame resolved, validated and written, Blender started through
 * the runner with the golden argv, the run judged by the success
 * predicate, the frame's luma measured, every exit code and stderr tail
 * kept. The exit-code matrix reuses it with the scene path or the output
 * directory broken on purpose, and runs the one argv outside the applier
 * (a missing .blend file) that Blender answers with exit 1.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../../src/cli/logger.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import type { LadderAttempt } from '../../src/lanes/blender/ladder.ts';
import { cacheOutputStem, resolveScene } from '../../src/lanes/blender/resolve-scene.ts';
import { batchTimeoutMs, blenderArgs, runBlender } from '../../src/lanes/blender/runner.ts';
import { writeSceneDocument } from '../../src/lanes/blender/scene-file.ts';
import { crashLogIsNew, crashLogMtime, crashLogPath, judgeBlenderRun, measureFrameYavg } from '../../src/lanes/blender/success.ts';
import type { BlenderVerdict } from '../../src/lanes/blender/success.ts';
import type { ProcessResult, ProcessRunner } from '../../src/process/process-runner.ts';
import { stderrTail } from '../../src/process/process-runner.ts';
import type { BlenderRenderTools } from '../../src/render/blender-shot.ts';
import { framePath } from '../../src/render/cache.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import { bake } from '../../src/shared/camera/bake.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import { solveBasePose } from '../../src/shared/composition/solver.ts';
import type { LookBible } from '../../src/shared/contracts/look-bible.ts';
import type { Shot } from '../../src/shared/contracts/shot-spec.ts';
import type { ExitCodeRow } from './m5-report.ts';
import { never } from './m5-support.ts';

/** What one raw render needs. */
export interface RawRenderOptions {
  readonly shot: Shot;
  readonly look: LookBible;
  readonly spec: RenderSpec;
  readonly frame: number;
  readonly attempt: LadderAttempt;
  readonly tools: BlenderRenderTools;
  readonly dataDir: string;
  readonly hdriPath: string | null;
  /** Scratch folder for the scene document, the frame and Blender's logs. */
  readonly workDir: string;
  readonly runner: ProcessRunner;
  readonly log: Logger;
  /** When set, this path is handed to Blender as the scene instead of the document written (the exit-code matrix). */
  readonly scenePathOverride?: string;
  /** When set, this path is handed to Blender as the frames directory instead of the folder under workDir (the exit-code matrix). */
  readonly outDirOverride?: string;
}

/** What one raw render produced. */
export interface RawRender {
  readonly attempt: LadderAttempt;
  readonly args: readonly string[];
  readonly result: ProcessResult;
  readonly verdict: BlenderVerdict;
  readonly framePath: string;
  /** The frame's YAVG through the gate's conversion; null when the file is missing or unreadable. */
  readonly yavg: number | null;
  readonly crashLogNew: boolean;
  readonly stderrTail: string;
}

/** Resolves, validates and writes the one-frame scene document, runs Blender on it and judges the run. */
export async function rawRender(options: RawRenderOptions): Promise<RawRender> {
  const { shot, look, spec, frame, attempt, tools } = options;
  const sceneDir = ensureDirectory(join(options.workDir, 'scene'));
  const framesDir = options.outDirOverride ?? ensureDirectory(join(options.workDir, 'frames'));
  const camera = bake(shot, spec, solveBasePose(shot, spec));
  const scene = resolveScene({ shot, look, spec, camera, frames: [frame], still: true, attempt: attempt.attempt, hdriPath: options.hdriPath, framesDirectory: framesDir, outputStem: cacheOutputStem });
  validateDocument('blender-scene', scene);
  const written = await writeSceneDocument(sceneDir, scene);
  const scenePath = options.scenePathOverride ?? written.path;
  const args = blenderArgs({ backend: attempt.gpuBackend, eevee: attempt.attempt.engine === 'eevee', scenePath, outDir: framesDir.replace(/\\/g, '/') });
  const crashLog = crashLogPath();
  const crashLogMtimeBefore = crashLogMtime(crashLog);
  const spawnedAt = Date.now();
  const result = await runBlender({
    runner: options.runner, executable: tools.blender.path, args, dataDir: options.dataDir, cwd: options.workDir, timeoutMs: batchTimeoutMs(1, spec.width, spec.height), signal: never, log: options.log,
    stdoutFile: join(sceneDir, 'blender-stdout.log'), stderrFile: join(sceneDir, 'blender-stderr.log'),
  });
  const expected = framePath(framesDir, frame);
  const verdict = await judgeBlenderRun({ result, expectedFrames: [expected], spawnedAt, crashLogPath: crashLog, crashLogMtimeBefore, runner: options.runner, ffmpegPath: tools.ffmpeg.path, statsPath: join(sceneDir, 'first-frame-yavg.txt'), signal: never });
  const yavg = await measureFrameYavg(options.runner, tools.ffmpeg.path, expected, join(sceneDir, 'frame-yavg.txt'), never);
  options.log.info(`${attempt.name}: exit ${result.exitCode === null ? 'none' : String(result.exitCode)} in ${(result.elapsedMs / 1000).toFixed(1)} s, ${verdict.ok ? 'ok' : `${verdict.code}: ${verdict.reason}`}`);
  return { attempt, args, result, verdict, framePath: expected, yavg: yavg ?? null, crashLogNew: crashLogIsNew(crashLog, crashLogMtimeBefore), stderrTail: stderrTail(result.stderr) };
}

/** One scenario of the exit-code matrix: its row, the argv it ran and a sentence on what it shows. */
export interface ExitScenario {
  readonly row: ExitCodeRow;
  readonly args: readonly string[];
  readonly note: string;
}

/** The row of a judged raw render. */
function judgedRow(scenario: string, render: RawRender): ExitCodeRow {
  return { scenario, exitCode: render.result.exitCode, verdictCode: render.verdict.ok ? 'ok' : render.verdict.code, stderrTail: render.stderrTail };
}

/**
 * The exit-code matrix: the successful Cycles run (exit 0), a scene path
 * that is not JSON (json.load raises: exit 3), a frames directory that is
 * a file (the render operator raises a RuntimeError: exit 3, the render
 * failure the applier turns into a Python exception), and Blender refusing
 * a missing .blend file outside the applier (exit 1, not judged).
 */
export async function exitMatrix(options: RawRenderOptions, success: RawRender | undefined): Promise<readonly ExitScenario[]> {
  const scenarios: ExitScenario[] = [];
  if (success !== undefined) {
    scenarios.push({ row: judgedRow('success: Cycles OptiX, one frame', success), args: success.args, note: 'The run of the one-frame table above: exit 0, the frame present and non-black, no crash log.' });
  }
  const notJson = join(ensureDirectory(options.workDir), 'not-json.txt');
  writeFileSync(notJson, 'this is not a scene document\n', 'utf8');
  const python = await rawRender({ ...options, workDir: join(options.workDir, 'python-exception'), scenePathOverride: notJson });
  scenarios.push({ row: judgedRow('Python exception: the scene path is not JSON', python), args: python.args, note: '`json.load` raises in the applier; `--python-exit-code 3` turns the exception into exit 3, which the predicate reports as blender-script with the stderr tail.' });
  const outFile = join(ensureDirectory(join(options.workDir, 'outdir-is-a-file')), 'frames');
  writeFileSync(outFile, 'a file where the frames directory should be\n', 'utf8');
  const renderFailure = await rawRender({ ...options, workDir: join(options.workDir, 'outdir-is-a-file'), outDirOverride: outFile });
  scenarios.push({ row: judgedRow('render failure: the frames directory is a file', renderFailure), args: renderFailure.args, note: 'Blender cannot save the frame; `bpy.ops.render.render` raises a RuntimeError ("Render error ... cannot save"), so the render failure surfaces as a Python exception (exit 3), not as exit 1.' });
  const missingBlend = join(options.workDir, 'missing.blend');
  const refusalArgs = ['-b', '--factory-startup', '--disable-autoexec', '-noaudio', '--offline-mode', missingBlend];
  const refusal = await runBlender({ runner: options.runner, executable: options.tools.blender.path, args: refusalArgs, dataDir: options.dataDir, cwd: options.workDir, timeoutMs: 120_000, signal: never, log: options.log });
  scenarios.push({ row: { scenario: 'Blender refuses a missing .blend file (outside the applier)', exitCode: refusal.exitCode, verdictCode: 'not judged', stderrTail: stderrTail(refusal.stderr) }, args: refusalArgs, note: 'The one exit 1 found: Blender in background mode exits 1 when a file named on its command line cannot be read. The applier\'s argv names no .blend file, so a lane run never takes this path.' });
  return scenarios;
}
