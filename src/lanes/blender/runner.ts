/**
 * How Blender is started for one batch of frames (ADR 0004 decision 4):
 * the argument list, golden-tested, that runs blender/apply_scene.py in
 * background mode with the factory configuration, no autoexec, no audio,
 * no network, the GPU backend named for an EEVEE attempt, a Python
 * exception mapped to exit 3, and the scene document and the frames
 * directory after "--". BLENDER_USER_RESOURCES points at a folder under
 * the data directory so a user's preferences and add-ons cannot change a
 * render. Only blender.exe is ever spawned: blender-launcher.exe starts
 * Blender in a new console whose output cannot be captured.
 */
import { basename, join } from 'node:path';
import type { Logger } from '../../cli/logger.ts';
import { InvalidExecutableError } from '../../errors/vision-forge-error.ts';
import { ensureDirectory } from '../../fs/paths.ts';
import { repositoryRoot } from '../../harness/served-roots.ts';
import type { ProcessResult, ProcessRunner } from '../../process/process-runner.ts';
import { pythonExitCode } from '../../tools/blender-probe.ts';

/** The GPU backend an EEVEE attempt asks Blender for; null for a Cycles attempt, which needs no GPU context. */
export type GpuBackend = 'opengl' | 'vulkan';

/** The applier, the one Python file (AGENTS.md), by absolute path. */
export const applierPath: string = join(repositoryRoot, 'blender', 'apply_scene.py');

/** The Python expression an EEVEE attempt runs before the applier, so a machine without a GPU context fails before any scene work. */
export const gpuPreflightExpression = 'import gpu; gpu.init()';

/** The folder under the data directory Blender takes its user resources from, so user preferences and add-ons stay out of renders. */
export function blenderUserResourcesDir(dataDir: string): string {
  return join(dataDir, 'blender-user');
}

/** What the argument list is built from. */
export interface BlenderArgsOptions {
  /** The GPU backend of an EEVEE attempt; null for Cycles. */
  readonly backend: GpuBackend | null;
  /** True for an EEVEE attempt: the backend flag and the gpu.init() preflight are added. */
  readonly eevee: boolean;
  readonly scenePath: string;
  readonly outDir: string;
}

/** The argument list of ADR 0004 decision 4, in its exact order; the GPU backend and the preflight appear only for an EEVEE attempt. */
export function blenderArgs(options: BlenderArgsOptions): readonly string[] {
  const args: string[] = ['-b', '--factory-startup', '--disable-autoexec', '-noaudio', '--offline-mode'];
  if (options.eevee) {
    if (options.backend === null) throw new RangeError('An EEVEE attempt names its GPU backend.');
    args.push('--gpu-backend', options.backend);
  }
  // --python-exit-code applies to the expressions and scripts after it, so it precedes both.
  args.push('--python-exit-code', String(pythonExitCode));
  if (options.eevee) args.push('--python-expr', gpuPreflightExpression);
  args.push('-P', applierPath, '--', options.scenePath, options.outDir);
  return args;
}

/** The pixels of a 1080p frame, the size the per-frame time budget is stated at. */
export const referencePixels = 1920 * 1080;

/** The time budget of a batch: 60 s for Blender's start and the shader compile plus a per-frame allowance stated at 1080p and scaled by the frame's pixels. */
export function batchTimeoutMs(frameCount: number, width: number, height: number, secondsPerFrameAt1080p = 30): number {
  const perFrame = secondsPerFrameAt1080p * ((width * height) / referencePixels);
  return Math.round((60 + frameCount * perFrame) * 1000);
}

/** True when the path names the real Blender executable (blender.exe on Windows, blender elsewhere), never the launcher or anything else. */
export function isBlenderExecutable(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === 'blender.exe' || name === 'blender';
}

/** What one Blender run needs. */
export interface RunBlenderOptions {
  readonly runner: ProcessRunner;
  /** The blender executable as tools.json records it. */
  readonly executable: string;
  readonly args: readonly string[];
  readonly dataDir: string;
  /** The directory Blender runs in: the frames directory of the batch. */
  readonly cwd: string;
  readonly timeoutMs: number;
  /** When set, Blender's standard output and error are mirrored to these files. */
  readonly stdoutFile?: string;
  readonly stderrFile?: string;
  readonly signal: AbortSignal;
  readonly log: Logger;
}

/** Runs Blender once and returns the raw result; the predicate in success.ts says what it means. Refuses anything but blender.exe. */
export async function runBlender(options: RunBlenderOptions): Promise<ProcessResult> {
  if (!isBlenderExecutable(options.executable)) {
    throw new InvalidExecutableError(options.executable, 'only blender.exe (never blender-launcher.exe) can be run, since the launcher opens a new console whose output cannot be read');
  }
  ensureDirectory(blenderUserResourcesDir(options.dataDir));
  options.log.debug(`blender ${options.args.join(' ')}`);
  return options.runner.run({
    label: 'blender',
    executable: options.executable,
    args: [...options.args],
    cwd: options.cwd,
    // The runner layers this over the process environment; the one override keeps user preferences out of the render.
    env: { BLENDER_USER_RESOURCES: blenderUserResourcesDir(options.dataDir) },
    timeoutMs: options.timeoutMs,
    ...(options.stdoutFile === undefined ? {} : { stdoutFile: options.stdoutFile }),
    ...(options.stderrFile === undefined ? {} : { stderrFile: options.stderrFile }),
  }, options.signal);
}
