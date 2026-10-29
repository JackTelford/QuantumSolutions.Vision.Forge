/**
 * The one page every browser lane renders in. Node writes it into the
 * shot's page directory and the harness serves it as /page/index.html; the
 * page itself holds no lane code, only the frame-sized root element, the
 * @font-face rules of the bundled fonts, the three import map and the
 * runtime's module script, which installs the capture protocol on window.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VisionForgeError } from '../../errors/vision-forge-error.ts';
import { ensureDirectory } from '../../fs/paths.ts';
import { importMapScriptTag } from '../../harness/import-map.ts';
import { fontsUrlPrefix, pageFileName, pageUrlPrefix, rootElementId, runtimeModulePath, sourceUrlPrefix } from '../../shared/harness/protocol.ts';
import { fontFaceCss } from '../../shared/typography/scale.ts';

function assertFrameSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new VisionForgeError({
      code: 'page-size',
      message: `The page size ${String(width)}x${String(height)} is not a pair of positive whole pixels.`,
      hint: 'The shot spec sets width and height; validate it first.',
    });
  }
}

/** The page document for a frame size, exactly as the harness contract states it. */
export function shotPageHtml(width: number, height: number): string {
  assertFrameSize(width, height);
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>vision-forge</title>',
    `<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}#${rootElementId}{position:relative;width:${width}px;height:${height}px;overflow:hidden}`,
    `${fontFaceCss(fontsUrlPrefix)}</style>`,
    importMapScriptTag(),
    `<script type="module" src="${sourceUrlPrefix}${runtimeModulePath}"></script>`,
    `</head><body><div id="${rootElementId}"></div></body></html>`,
    '',
  ].join('\n');
}

/** Writes index.html for a frame size into the page directory (created when missing) and returns its path. */
export function writeShotPage(pageDir: string, width: number, height: number): string {
  const html = shotPageHtml(width, height);
  const path = join(ensureDirectory(pageDir), pageFileName);
  writeFileSync(path, html, 'utf8');
  return path;
}

/** The URL the browser opens for the page served by a harness at a base URL such as http://127.0.0.1:5123. */
export function pageUrl(harnessUrl: string): string {
  return `${harnessUrl.replace(/\/+$/, '')}${pageUrlPrefix}${pageFileName}`;
}
