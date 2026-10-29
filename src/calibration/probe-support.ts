/**
 * What the M4 probes (scripts/probes/m4-*.ts) share: the browser and
 * ffmpeg they render and measure with, the data directory whose installed
 * HDRIs the three lane may use, the machine facts a report opens with,
 * and a reduced copy of a still for the evidence folder. Node only.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDirectory } from '../fs/paths.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { browserVersion, findBrowsers } from '../tools/browsers.ts';
import { requireFfmpeg, runFfmpeg } from '../tools/ffmpeg.ts';
import type { StillBrowser } from './render-still.ts';

/** The environment variable that points a probe at a data directory whose assets/ folder holds installed HDRIs. */
export const probeDataDirVariable = 'VF_PROBE_DATA_DIR';

/** The data directory a probe renders from: the variable when set, else a folder under the system temp directory (no HDRI installed there, so the three lane uses its room environment). */
export function probeDataDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = env[probeDataDirVariable];
  return ensureDirectory(named !== undefined && named.length > 0 ? named : join(tmpdir(), 'vision-forge-m4', 'data'));
}

/** A scratch folder for a probe's renders under the system temp directory, created. */
export function probeWorkDir(name: string): string {
  return ensureDirectory(join(tmpdir(), 'vision-forge-m4', name));
}

/** The first installed browser (Edge before Chrome) with its version read from the executable; throws a sentence when none is installed. */
export async function probeBrowser(runner: ProcessRunner, signal: AbortSignal): Promise<StillBrowser> {
  const found = findBrowsers().found[0];
  if (found === undefined) throw new Error('No browser is installed; the M4 probes need Microsoft Edge or Google Chrome.');
  const version = (await browserVersion(runner, found.path, process.env, process.platform, signal)) ?? '0.0.0.0';
  return { channel: found.channel, path: found.path, version };
}

/** ffmpeg's path and the first line of `ffmpeg -version`. */
export async function probeFfmpeg(runner: ProcessRunner, signal: AbortSignal): Promise<{ readonly path: string; readonly version: string }> {
  const path = requireFfmpeg();
  const result = await runFfmpeg(runner, path, ['-version'], { label: 'ffmpeg -version' }, signal);
  return { path, version: result.stdout.split(/\r?\n/)[0] ?? '' };
}

/** Writes a copy of a PNG scaled to a width (the height follows, kept even) for the evidence folder. */
export async function reducePng(runner: ProcessRunner, ffmpegPath: string, source: string, target: string, widthPx: number, signal: AbortSignal): Promise<void> {
  await runFfmpeg(runner, ffmpegPath, ['-nostats', '-y', '-i', source, '-vf', `scale=${String(widthPx)}:-2`, '-frames:v', '1', '-update', '1', target], { label: 'ffmpeg reduce' }, signal);
}

/** The machine facts a report opens with: platform, Node, the browser and ffmpeg used. */
export function machineFacts(browser: StillBrowser, ffmpegVersion: string): readonly (readonly [string, string])[] {
  return [
    ['Platform', `${process.platform} ${process.arch}`],
    ['Node', process.version],
    ['Browser', `${browser.channel} ${browser.version}`],
    ['ffmpeg', ffmpegVersion],
    ['Generated', new Date().toISOString()],
  ];
}
