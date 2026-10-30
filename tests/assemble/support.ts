/**
 * Helpers for the assemble tests: synthetic sources made with ffmpeg
 * (testsrc2, color and rgbtestsrc pictures, sine tones), plan builders, and
 * measurements read back through ffmpeg and ffprobe. Every program runs
 * through the repository's ChildProcessRunner and runFfmpeg.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { AssemblyPlan, Clip, SourceKind } from '../../src/shared/contracts/assembly-plan.ts';
import { runFfmpeg } from '../../src/tools/ffmpeg.ts';

/** A signal that never aborts. */
export const never: AbortSignal = new AbortController().signal;

/** The real process runner. */
export const runner: ChildProcessRunner = new ChildProcessRunner();

/** Frames per second of every synthetic source. */
export const sourceFps = 30;

/** Width and height of every synthetic source but the large one. */
export const sourceSize: { readonly width: number; readonly height: number } = { width: 320, height: 180 };

/** Width and height of the large source. */
export const largeSourceSize: { readonly width: number; readonly height: number } = { width: 640, height: 360 };

/** Frames in every synthetic clip. */
export const sourceFrames = 30;

/** Where the synthetic sources are. */
export interface SyntheticSources {
  readonly dir: string;
  /** 30 PNG frames of testsrc2, f0001.png onward. */
  readonly testsrcPattern: string;
  /** 30 PNG frames of a flat blue, f0001.png onward. */
  readonly colorPattern: string;
  /** 30 PNG frames of testsrc2 at 640x360, f0001.png onward. */
  readonly largePattern: string;
  /** 30 frames of rgbtestsrc as an H.264 MP4. */
  readonly videoPath: string;
  /** 30 frames of rgbtestsrc as an H.264 MP4 whose pixels are 4:3 (SAR 4:3 at 320x180, so it displays 16:6.75). */
  readonly anamorphicVideoPath: string;
  /** Two 0.8 s sine tones (440 Hz and 660 Hz) at 48 kHz mono. */
  readonly narration: readonly [string, string];
  /** A 4 s 220 Hz sine at 48 kHz stereo. */
  readonly music: string;
  /** One caption from 0.5 s to 1.5 s. */
  readonly srtPath: string;
}

async function ffmpeg(executable: string, args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const result = await runFfmpeg(runner, executable, args, { label: 'ffmpeg (test)', timeoutMs: 120_000 }, never);
  return { stdout: result.stdout, stderr: result.stderr };
}

/** Generates every synthetic source under `dir`. */
export async function makeSyntheticSources(ffmpegPath: string, dir: string): Promise<SyntheticSources> {
  const size = `${sourceSize.width}x${sourceSize.height}`;
  const largeSize = `${largeSourceSize.width}x${largeSourceSize.height}`;
  const testsrcDir = join(dir, 'testsrc');
  const colorDir = join(dir, 'color');
  const largeDir = join(dir, 'large');
  mkdirSync(testsrcDir, { recursive: true });
  mkdirSync(colorDir, { recursive: true });
  mkdirSync(largeDir, { recursive: true });
  const testsrcPattern = join(testsrcDir, 'f%04d.png');
  const colorPattern = join(colorDir, 'f%04d.png');
  const largePattern = join(largeDir, 'f%04d.png');
  const videoPath = join(dir, 'rgbtest.mp4');
  const anamorphicVideoPath = join(dir, 'rgbtest-anamorphic.mp4');
  const narration: [string, string] = [join(dir, 'line1.wav'), join(dir, 'line2.wav')];
  const music = join(dir, 'music.wav');
  const srtPath = join(dir, 'captions.srt');
  const h264 = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'];
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${sourceFps}:duration=1`, '-frames:v', String(sourceFrames), testsrcPattern]);
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x2040a0:size=${size}:rate=${sourceFps}:duration=1`, '-frames:v', String(sourceFrames), colorPattern]);
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${largeSize}:rate=${sourceFps}:duration=1`, '-frames:v', String(sourceFrames), largePattern]);
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `rgbtestsrc=size=${size}:rate=${sourceFps}:duration=1`, '-frames:v', String(sourceFrames), ...h264, videoPath]);
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `rgbtestsrc=size=${size}:rate=${sourceFps}:duration=1`, '-frames:v', String(sourceFrames), '-vf', 'setsar=4/3', ...h264, anamorphicVideoPath]);
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.8', '-c:a', 'pcm_s16le', narration[0]]);
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=0.8', '-c:a', 'pcm_s16le', narration[1]]);
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=4', '-ac', '2', '-c:a', 'pcm_s16le', music]);
  writeFileSync(srtPath, '1\n00:00:00,500 --> 00:00:01,500\nHello captions\n', 'utf8');
  return { dir, testsrcPattern, colorPattern, largePattern, videoPath, anamorphicVideoPath, narration, music, srtPath };
}

/** Where a synthetic text plate's pixels are opaque, in pixels of the synthetic size. */
export interface PlateBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The opaque box of makeAlphaPlate: white, inside the frame, away from the edges. */
export const plateBox: PlateBox = { x: 40, y: 40, w: 80, h: 40 };

/**
 * Writes 30 PNG frames with alpha under `dir`, f0001.png onward: opaque
 * white inside plateBox and fully transparent elsewhere, the way the html
 * lane's text plate is captured. drawbox leaves alpha alone, so the alpha
 * plane is written with geq.
 */
export async function makeAlphaPlate(ffmpegPath: string, dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const pattern = join(dir, 'f%04d.png');
  const { x, y, w, h } = plateBox;
  const alpha = `if(between(X,${x},${x + w - 1})*between(Y,${y},${y + h - 1}),255,0)`;
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=white:size=${sourceSize.width}x${sourceSize.height}:rate=${sourceFps}:duration=1,format=rgba,geq=r='255':g='255':b='255':a='${alpha}'`, '-frames:v', String(sourceFrames), '-pix_fmt', 'rgba', pattern]);
  return pattern;
}

/** The average luma (limited range) of a `w:h:x:y` region of frame `index` of a video, from signalstats. */
export async function regionLuma(ffmpegPath: string, videoPath: string, index: number, crop: string): Promise<number> {
  const result = await ffmpeg(ffmpegPath, ['-loglevel', 'info', '-i', videoPath, '-vf', `select=eq(n\\,${index}),crop=${crop},signalstats,metadata=print:key=lavfi.signalstats.YAVG`, '-frames:v', '1', '-f', 'null', '-']);
  return Number.parseFloat(/lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(result.stderr)?.[1] ?? 'NaN');
}

/** A clip of the synthetic length. */
export function clip(id: string, kind: SourceKind, path: string, durationFrames = sourceFrames): Clip {
  return { id, source: { kind, path, startNumber: kind === 'frames' ? 1 : 0 }, durationFrames };
}

/** A plan over the synthetic sources: two frame clips joined by a cut, H.264 CRF 18 veryfast, unless overridden. */
export function makePlan(sources: SyntheticSources, outputPath: string, overrides: Partial<AssemblyPlan> = {}): AssemblyPlan {
  return {
    kind: 'assembly-plan',
    version: 1,
    fps: sourceFps,
    width: sourceSize.width,
    height: sourceSize.height,
    clips: [clip('a', 'frames', sources.testsrcPattern), clip('b', 'frames', sources.colorPattern)],
    transitions: [],
    output: { path: outputPath, codec: 'h264', crf: 18, preset: 'veryfast', faststart: true },
    ...overrides,
  };
}

/** Frames decoded from a file, counted by ffprobe. */
export async function countFrames(ffprobePath: string, path: string): Promise<number> {
  const result = await runFfmpeg(runner, ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path], { label: 'ffprobe (test)', timeoutMs: 120_000 }, never);
  return Number.parseInt(result.stdout.trim(), 10);
}

/** One stream entry, for example `pix_fmt`, of a stream (the first video stream unless another selector such as `a:0` is given). */
export async function probeEntry(ffprobePath: string, path: string, entry: string, stream = 'v:0'): Promise<string> {
  const result = await runFfmpeg(runner, ffprobePath, ['-v', 'error', '-select_streams', stream, '-show_entries', `stream=${entry}`, '-of', 'csv=p=0', path], { label: 'ffprobe (test)', timeoutMs: 120_000 }, never);
  return result.stdout.trim();
}

/** Writes frame `index` (0-based) of a video as a PNG. */
export async function extractFrame(ffmpegPath: string, videoPath: string, index: number, pngPath: string): Promise<void> {
  await ffmpeg(ffmpegPath, ['-y', '-loglevel', 'error', '-i', videoPath, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', '-fps_mode', 'passthrough', pngPath]);
}

/** SSIM and PSNR between two images or two videos of equal size, averaged over every frame, as ffmpeg measures them. */
export async function compare(ffmpegPath: string, pathA: string, pathB: string): Promise<{ readonly ssim: number; readonly psnr: number }> {
  const result = await ffmpeg(ffmpegPath, ['-loglevel', 'info', '-i', pathA, '-i', pathB, '-lavfi', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim;[0:v]format=gbrp[c];[1:v]format=gbrp[d];[c][d]psnr', '-f', 'null', '-']);
  const ssim = /SSIM .*All:([0-9.]+)/.exec(result.stderr)?.[1] ?? 'NaN';
  const psnr = /PSNR .*average:([0-9.]+|inf)/.exec(result.stderr)?.[1] ?? 'NaN';
  return { ssim: Number.parseFloat(ssim), psnr: psnr === 'inf' ? Number.POSITIVE_INFINITY : Number.parseFloat(psnr) };
}

/** The highest luma (limited range, 16 is black) in a `w:h:x:y` region of an image's first frame, from signalstats. */
export async function peakLuma(ffmpegPath: string, imagePath: string, crop: string): Promise<number> {
  const result = await ffmpeg(ffmpegPath, ['-loglevel', 'info', '-i', imagePath, '-vf', `crop=${crop},signalstats,metadata=print:key=lavfi.signalstats.YMAX`, '-f', 'null', '-']);
  return Number.parseInt(/lavfi\.signalstats\.YMAX=(\d+)/.exec(result.stderr)?.[1] ?? 'NaN', 10);
}

/** Integrated loudness in LUFS of a file's first audio stream, from the ebur128 summary. */
export async function integratedLoudness(ffmpegPath: string, path: string): Promise<number> {
  const result = await ffmpeg(ffmpegPath, ['-loglevel', 'info', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summaryStart = result.stderr.lastIndexOf('Summary:');
  const summary = summaryStart >= 0 ? result.stderr.slice(summaryStart) : '';
  const match = /\bI:\s+(-?[0-9.]+) LUFS/.exec(summary);
  return Number.parseFloat(match?.[1] ?? 'NaN');
}

/** The SHA-256 of a file, as hex. */
export function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
