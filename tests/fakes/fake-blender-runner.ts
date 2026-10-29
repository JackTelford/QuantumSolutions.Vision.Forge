/**
 * A ProcessRunner that plays Blender and ffmpeg for the blender-lane
 * tests without either program: a blender.exe run reads the scene
 * document named after "--", writes one solid PNG per frame of its range
 * into the output directory (unless told to fail) and exits as scripted;
 * an ffmpeg run answers framehash with one hash per frame, signalstats
 * with a YAVG print file and the still finishing by copying its input to
 * its output. Every spec is recorded. Not a test file.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJsonFile } from '../../src/fs/atomic-json.ts';
import type { ProcessResult, ProcessRunner, ProcessSpec } from '../../src/process/process-runner.ts';
import { frameFileName } from '../../src/render/cache.ts';
import type { BlenderScene } from '../../src/shared/contracts/blender-scene.ts';
import { sha256Hex } from '../../src/shared/sha256.ts';
import { frameColor, writeSolidPng } from './png.ts';

/** How one Blender run behaves; every field has a default that renders the batch. */
export interface BlenderBehaviour {
  /** The exit code; 0 by default. */
  readonly exitCode?: number | null;
  /** False to write no frames (a run that failed before rendering); true by default. */
  readonly writeFrames?: boolean;
  /** Standard error text, empty by default. */
  readonly stderr?: string;
  /** True for a run the runner stopped at its time limit. */
  readonly timedOut?: boolean;
  /** A side effect after the frames, for example writing a crash log. */
  readonly after?: () => void;
}

/** The scripted runner. */
export class FakeBlenderRunner implements ProcessRunner {
  /** Every spec that was run, in order. */
  readonly invocations: ProcessSpec[] = [];
  /** The YAVG every signalstats run prints; 100 by default (a lit frame). */
  yavg = 100;
  private readonly behaviours: BlenderBehaviour[];

  constructor(behaviours: readonly BlenderBehaviour[] = []) {
    this.behaviours = [...behaviours];
  }

  /** The blender.exe runs so far. */
  get blenderRuns(): readonly ProcessSpec[] {
    return this.invocations.filter((spec) => /blender(\.exe)?$/i.test(spec.executable));
  }

  /** Dispatches on the program: blender renders as scripted, ffmpeg answers by its arguments. */
  run(spec: ProcessSpec, signal: AbortSignal): Promise<ProcessResult> {
    this.invocations.push(spec);
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    if (/blender(\.exe)?$/i.test(spec.executable)) return Promise.resolve(this.runBlender(spec));
    if (/ffmpeg(\.exe)?$/i.test(spec.executable)) return this.runFfmpeg(spec);
    return Promise.reject(new Error(`Unexpected process run: ${spec.executable} ${spec.args.join(' ')}`));
  }

  private runBlender(spec: ProcessSpec): ProcessResult {
    const behaviour = this.behaviours.shift() ?? {};
    const separator = spec.args.indexOf('--');
    const scenePath = spec.args[separator + 1] ?? '';
    const outDir = spec.args[separator + 2] ?? '';
    const scene = readJsonFile(scenePath) as BlenderScene;
    if (behaviour.writeFrames !== false) {
      for (let frame = scene.output.frameStart; frame <= scene.output.frameEnd; frame += 1) {
        writeSolidPng(join(outDir, frameFileName(frame)), scene.output.width, scene.output.height, frameColor(frame));
      }
    }
    behaviour.after?.();
    return { exitCode: behaviour.exitCode === undefined ? 0 : behaviour.exitCode, signal: null, stdout: '', stderr: behaviour.stderr ?? '', elapsedMs: 5, timedOut: behaviour.timedOut ?? false };
  }

  private async runFfmpeg(spec: ProcessSpec): Promise<ProcessResult> {
    const { args } = spec;
    if (args.includes('framehash')) {
      const first = Number(args[args.indexOf('-start_number') + 1]);
      const count = Number(args[args.indexOf('-frames:v') + 1]);
      const lines = ['#format: frame checksums', '#stream#, dts,        pts, duration,     size, hash'];
      for (let pts = 0; pts < count; pts += 1) lines.push(`0, ${pts}, ${pts}, 1, 384, ${await sha256Hex(`frame-${first + pts}`)}`);
      return { exitCode: 0, signal: null, stdout: `${lines.join('\n')}\n`, stderr: '', elapsedMs: 1, timedOut: false };
    }
    if (args.includes('-update')) {
      // The still finishing: the graded still is the raw frame copied.
      const input = args[args.indexOf('-i') + 1] ?? '';
      const output = args[args.length - 1] ?? '';
      mkdirSync(dirname(output), { recursive: true });
      copyFileSync(input, output);
      return { exitCode: 0, signal: null, stdout: '', stderr: '', elapsedMs: 1, timedOut: false };
    }
    const filter = args[args.indexOf('-vf') + 1] ?? '';
    const match = /file='([^']+)'/.exec(filter);
    if (match !== null) {
      const statsPath = match[1]?.replace(/\\:/g, ':') ?? '';
      mkdirSync(dirname(statsPath), { recursive: true });
      writeFileSync(statsPath, `frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=${this.yavg}\n`, 'utf8');
      return { exitCode: 0, signal: null, stdout: '', stderr: '', elapsedMs: 1, timedOut: false };
    }
    throw new Error(`Unexpected ffmpeg run: ${args.join(' ')}`);
  }
}
