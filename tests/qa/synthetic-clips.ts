/**
 * Synthetic clips, stills and tones for the QA and sheet tests, built by the
 * installed ffmpeg from lavfi sources only (testsrc2, rgbtestsrc, color,
 * sine), so every input is deterministic and nothing binary is committed.
 * Tests skip when ffmpeg is absent; the builders throw then.
 */
import { join } from 'node:path';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { AssemblyPlan, Transition } from '../../src/shared/contracts/assembly-plan.ts';
import { findFfmpeg, findFfprobe, runFfmpeg } from '../../src/tools/ffmpeg.ts';

/** The production runner; the fixtures are real ffmpeg runs. */
export const runner = new ChildProcessRunner();

/** A signal that never aborts. */
export const never: AbortSignal = new AbortController().signal;

/** Width x height of every fixture clip. */
export const fixtureSize = '320x180';

/** Frames per second of every fixture clip. */
export const fixtureFps = 30;

/** Absolute path of ffmpeg; throws when it is not installed (tests skip before calling). */
export function ffmpegPath(): string {
  const found = findFfmpeg();
  if (found === undefined) throw new Error('ffmpeg is not installed');
  return found.path;
}

/** Absolute path of ffprobe next to ffmpeg; throws when it is not installed. */
export function ffprobePath(): string {
  const found = findFfprobe(findFfmpeg()?.path);
  if (found === undefined) throw new Error('ffprobe is not installed');
  return found.path;
}

/** Runs ffmpeg with -y and the given arguments; throws on a non-zero exit. */
export async function ff(args: readonly string[]): Promise<void> {
  await runFfmpeg(runner, ffmpegPath(), ['-nostats', '-y', ...args], { label: 'ffmpeg (fixture)' }, never);
}

const encode: readonly string[] = ['-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '18'];

/** 60 frames (2 s) of testsrc2: nothing for any check to flag. */
export async function makeCleanClip(dir: string): Promise<string> {
  const path = join(dir, 'clean.mp4');
  await ff(['-f', 'lavfi', '-i', `testsrc2=size=${fixtureSize}:rate=${fixtureFps}:duration=2`, '-frames:v', '60', ...encode, path]);
  return path;
}

/** The P6 recipe: 1 s testsrc2 (frames 0-29), 0.5 s black (30-44), 2 s mid-gray (45-104). */
export async function makeBlackFreezeClip(dir: string): Promise<string> {
  const path = join(dir, 'black-freeze.mp4');
  await ff([
    '-f', 'lavfi', '-i', `testsrc2=size=${fixtureSize}:rate=${fixtureFps}:duration=1`,
    '-f', 'lavfi', '-i', `color=c=black:size=${fixtureSize}:rate=${fixtureFps}:duration=0.5`,
    '-f', 'lavfi', '-i', `color=c=0x808080:size=${fixtureSize}:rate=${fixtureFps}:duration=2`,
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p', ...encode, path,
  ]);
  return path;
}

/** 1 s testsrc2 (YAVG about 121) then 1 s rgbtestsrc (YAVG about 52): a hard cut at frame 30 between two exposures. */
export async function makeTwoPatternClip(dir: string): Promise<string> {
  const path = join(dir, 'two-patterns.mp4');
  await ff([
    '-f', 'lavfi', '-i', `testsrc2=size=${fixtureSize}:rate=${fixtureFps}:duration=1`,
    '-f', 'lavfi', '-i', `rgbtestsrc=size=${fixtureSize}:rate=${fixtureFps}:duration=1`,
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p', ...encode, path,
  ]);
  return path;
}

/** A 3 s 440 Hz sine WAV passed through an audio filter, for example "volume=-20dB" or "loudnorm=I=-16:TP=-1.5:LRA=11". */
export async function makeTone(dir: string, name: string, audioFilter: string): Promise<string> {
  const path = join(dir, `${name}.wav`);
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-af', audioFilter, '-ar', '48000', path]);
  return path;
}

/** 30 frames of testsrc2 with a white box (x 0.1, y 0.2, w 0.4, h 0.4) and a mid-gray box (x 0.6, y 0.2, w 0.3, h 0.4) drawn over it. */
export async function makeBoxesClip(dir: string): Promise<string> {
  const path = join(dir, 'boxes.mp4');
  await ff([
    '-f', 'lavfi', '-i', `testsrc2=size=${fixtureSize}:rate=${fixtureFps}:duration=1`,
    '-vf', 'drawbox=x=32:y=36:w=128:h=72:color=white:t=fill,drawbox=x=192:y=36:w=96:h=72:color=0x808080:t=fill',
    '-frames:v', '30', ...encode, path,
  ]);
  return path;
}

/** `count` PNG frames of testsrc2 at 640x360 named f1.png, f2.png, ..., each a different frame of the pattern. */
export async function makeFramePngs(dir: string, count = 6): Promise<string[]> {
  const paths: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const path = join(dir, `f${index}.png`);
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2', '-vf', `select=eq(n\\,${index * 5})`, '-fps_mode', 'passthrough', '-frames:v', '1', path]);
    paths.push(path);
  }
  return paths;
}

/** A plan at the fixture size and rate: clips of the given lengths in frames, with the given transitions. */
export function planFor(clips: readonly { readonly id: string; readonly frames: number }[], transitions: readonly Transition[] = []): AssemblyPlan {
  return {
    kind: 'assembly-plan',
    version: 1,
    fps: fixtureFps,
    width: 320,
    height: 180,
    clips: clips.map((clip) => ({ id: clip.id, source: { kind: 'video', path: `C:/vf/${clip.id}.mp4`, startNumber: 0 }, durationFrames: clip.frames })),
    transitions: [...transitions],
    output: { path: 'C:/vf/out/film.mp4', codec: 'h264', crf: 16, preset: 'medium', faststart: true },
  };
}
