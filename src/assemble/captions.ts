/**
 * Captions: the SRT sidecar that is always copied next to the delivery, and
 * the `subtitles` filter that burns it into the picture when asked.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { CaptionStyle, Captions } from '../shared/contracts/assembly-plan.ts';
import { bundledFonts } from '../shared/typography/scale.ts';
import { filterPath } from '../tools/ffmpeg.ts';

/** libass lays an SRT out on a 384x288 script canvas and scales it to the picture, so a pixel size at the delivery's height is given in those units. */
export const assScriptHeight = 288;

/** A `#rrggbb` colour with an opacity as libass writes it: `&HAABBGGRR`, where AA is the transparency (00 opaque, FF clear). */
export function assColour(hex: string, opacity = 1): string {
  const rr = hex.slice(1, 3);
  const gg = hex.slice(3, 5);
  const bb = hex.slice(5, 7);
  const alpha = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255).toString(16).padStart(2, '0');
  return `&H${alpha}${bb}${gg}${rr}`.toUpperCase();
}

/** The `force_style` of a caption style at a picture height: the bundled family by its font name, the sizes in libass units, the text colour on an opaque-box scrim, no outline, no shadow. */
export function captionForceStyle(style: CaptionStyle, pictureHeight: number): string {
  const unit = assScriptHeight / pictureHeight;
  const fontSize = Math.max(1, Math.round(style.fontSizePx * unit));
  const margin = Math.max(0, Math.round(style.marginBottomPx * unit));
  return [
    `FontName=${bundledFonts[style.fontFamily].cssFamily}`,
    `FontSize=${String(fontSize)}`,
    `PrimaryColour=${assColour(style.textColor)}`,
    `BackColour=${assColour(style.scrimColor, style.scrimOpacity)}`,
    'BorderStyle=4',
    'Outline=0',
    'Shadow=0',
    `MarginV=${String(margin)}`,
  ].join(',');
}

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

/**
 * The burn-in filter, placed after the finishing chain so the text is
 * neither graded, vignetted nor grained (ADR 0008 item 4); undefined when
 * the captions are sidecar-only. With a style the captions are set in the
 * look's body family from the bundled fonts directory (`fontsDir`) in the
 * look's colours; without one ffmpeg's own style applies.
 */
export function captionFilter(captions: Captions | undefined, fontsDir?: string, pictureHeight = 1080): string | undefined {
  if (captions === undefined || !captions.burnIn) return undefined;
  const parts = [`subtitles=${filterPath(captions.srtPath)}`];
  if (captions.style !== undefined) {
    if (fontsDir !== undefined) parts.push(`fontsdir=${filterPath(fontsDir)}`);
    parts.push(`force_style='${captionForceStyle(captions.style, pictureHeight)}'`);
  }
  return parts.join(':');
}
