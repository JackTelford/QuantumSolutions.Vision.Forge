/**
 * Shared inputs of the render tests: a Windows browser fingerprint of the
 * kind a manifest records, the inputs of a five-frame html shot's manifest,
 * and a 480x270 render spec. Not a test file: the test runner never loads
 * it on its own.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirectory } from '../../src/fs/paths.ts';
import type { ManifestFingerprint, ManifestInputs } from '../../src/render/manifest.ts';
import type { PageSeam } from '../../src/render/seams.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import type { Browser, ToolsManifest } from '../../src/shared/contracts/tools.ts';
import { hex64 } from '../schema/documents/examples.ts';

/** An Edge entry of the kind doctor records on a hardware machine. */
export const edgeExample: Browser = {
  channel: 'msedge',
  path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  version: '156.0.4314.42',
  webgl: { renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)', vendor: 'Google Inc. (NVIDIA)', webgl2: true, hardware: true, extColorBufferFloat: true },
};

/** A tools manifest with ffmpeg at the given path and the given browsers; no ffmpeg when the path is undefined. */
export function toolsManifestExample(ffmpegPath: string | undefined, browsers: readonly Browser[]): ToolsManifest {
  return {
    kind: 'tools',
    version: 1,
    generatedAt: '2026-10-29T10:00:00.000Z',
    platform: { os: 'win32', arch: 'x64', release: '10.0.26300' },
    node: { path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v24.13.0' },
    interactiveSession: true,
    longPathsEnabled: false,
    programs: ffmpegPath === undefined ? {} : { ffmpeg: { path: ffmpegPath, version: '9.0.2-full_build-www.gyan.dev', filters: [], encoders: [] } },
    browsers: [...browsers],
    gpu: null,
    lanes: { html: browsers.length > 0, three: browsers.length > 0, blender: false, audio: false },
    narration: { installed: false, weightsVerified: false },
    problems: [],
  };
}

/** A page seam that writes a one-line index.html and names it under /page/, so renderShot can run without the html lane. */
export const fakePage: PageSeam = {
  writeShotPage(pageDir: string, width: number, height: number): void {
    writeFileSync(join(ensureDirectory(pageDir), 'index.html'), `<!doctype html><title>fake ${width}x${height}</title>\n`, 'utf8');
  },
  pageUrl(harnessUrl: string): string {
    return `${harnessUrl}/page/index.html`;
  },
};

/** 480 x 270 at 30 fps: the size the first goldens are rendered at. */
export const smallSpec: RenderSpec = { fps: 30, width: 480, height: 270 };

/** A fingerprint of the kind a browser lane records on Windows. */
export const fingerprintExample: ManifestFingerprint = {
  browser: { channel: 'msedge', version: '156.0.4314.42', args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--use-angle=d3d11'] },
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  appliedDpi: 96,
  clearType: { fontSmoothing: '2', fontSmoothingType: '2', orientation: '1', gamma: '1400' },
  node: 'v24.13.0',
  ffmpeg: '9.0.2-full_build-www.gyan.dev',
};

/** The inputs of a five-frame html shot's manifest, with overrides. */
export function manifestInputs(changes: Partial<ManifestInputs> = {}): ManifestInputs {
  return {
    shotId: 's03',
    key: hex64('c'),
    lane: 'html',
    renderProfile: { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' },
    fingerprint: fingerprintExample,
    fps: smallSpec.fps,
    width: smallSpec.width,
    height: smallSpec.height,
    frameCount: 5,
    startedAt: '2026-10-29T10:00:00.000Z',
    ...changes,
  };
}
