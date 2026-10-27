/**
 * Captions: the SRT sidecar that is always copied next to the delivery, and
 * the `subtitles` filter that burns it into the picture when asked.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { Captions } from '../shared/contracts/assembly-plan.ts';
import { filterPath } from '../tools/ffmpeg.ts';

/** Where the sidecar goes: the delivery's directory, its base name, `.srt`. */
export function sidecarPath(outputPath: string): string {
  return join(dirname(outputPath), `${basename(outputPath, extname(outputPath))}.srt`);
}

/** True when two paths name the same file once resolved: compared without case on Windows, where `Film.srt` and `film.srt` are one file. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** What copySidecar did: where the sidecar is, and whether this call wrote it (false when the plan's SRT already is the sidecar). */
export interface SidecarCopy {
  readonly path: string;
  readonly copied: boolean;
}

/** Copies the SRT next to the delivery; a source already at that path (in any letter case on Windows) is left alone. */
export function copySidecar(captions: Captions, outputPath: string): SidecarCopy {
  const target = sidecarPath(outputPath);
  if (samePath(captions.srtPath, target)) return { path: target, copied: false };
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(captions.srtPath, target);
  return { path: target, copied: true };
}

/** The burn-in filter, placed after the finishing chain so the text is neither graded, vignetted nor grained (ADR 0008 item 4); undefined when the captions are sidecar-only. */
export function captionFilter(captions: Captions | undefined): string | undefined {
  if (captions === undefined || !captions.burnIn) return undefined;
  return `subtitles=${filterPath(captions.srtPath)}`;
}
