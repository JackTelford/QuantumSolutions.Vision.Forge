/**
 * Probe P5: is seek-based frame capture deterministic on this machine, and
 * what does each stability flag change?
 *
 * One page holds a CSS @keyframes animation, a Web Animations API animation,
 * two WebGL2 canvases (preserveDrawingBuffer off and on) and two text blocks.
 * `seek(k, fps)` pauses every animation, sets its currentTime, renders the
 * canvases for frame k and returns computed state. Each run launches a fresh
 * browser, captures frames 0, 15, 30 and 59, and the probe compares pixel
 * hashes (ffmpeg framehash) across runs and flag sets.
 */
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Page } from 'playwright-core';
import { EvidenceReport, chromePath, compareImages, edgePath, ensureDir, ffmpegPath, framehash, machineFingerprint, repoRoot, runCommandBuffer, scratchDir, windowsFileVersion } from './lib.ts';
import type { Channel } from './browser-lib.ts';
import { availableChannels, baseArgs, closeQuietly, launchContext, profileDir, removeProfileDir, startStaticServer } from './browser-lib.ts';

const fps = 30;
const frames: readonly number[] = [0, 15, 30, 59];

const pageHtml: string = `<!doctype html><html><head><meta charset="utf-8"><title>determinism</title>
<style>
  html { background: #202020; }
  body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; position: relative; }
  #css { position: absolute; top: 40px; left: 0; width: 120px; height: 120px; background: #ff2020; animation: slide 2s linear infinite; z-index: 2; }
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(800px); } }
  #waapi { position: absolute; top: 200px; left: 0; width: 120px; height: 120px; background: #20ff20; z-index: 2; }
  #gl1 { position: absolute; top: 0; left: 0; width: 1920px; height: 1080px; z-index: 0; }
  #gl2 { position: absolute; top: 360px; left: 1400px; width: 400px; height: 300px; z-index: 1; }
  .text { position: absolute; left: 240px; color: #f0f0f0; font-size: 48px; line-height: 1.2; white-space: nowrap; z-index: 2; }
  #t1 { top: 420px; font-family: 'Segoe UI', sans-serif; }
  #t2 { top: 520px; font-family: 'Noto Sans', sans-serif; }
  #readout { position: absolute; left: 240px; top: 640px; color: #c0c0c0; font: 24px monospace; z-index: 2; }
</style></head>
<body>
<canvas id="gl1" width="1920" height="1080"></canvas>
<div id="css"></div>
<div id="waapi"></div>
<canvas id="gl2" width="400" height="300"></canvas>
<div id="t1" class="text">The quick brown fox jumps over the lazy dog 0123456789</div>
<div id="t2" class="text">Sphinx of black quartz, judge my vow. Noto Sans</div>
<div id="readout"></div>
<script>
(function () {
  const waapi = document.getElementById('waapi');
  const waapiAnimation = waapi.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 2000, fill: 'both' });
  const vs = 'attribute vec2 p; uniform float a; void main(){ float c=cos(a), s=sin(a); gl_Position=vec4(vec2(c*p.x-s*p.y, s*p.x+c*p.y), 0.0, 1.0); }';
  const fs = 'precision mediump float; void main(){ gl_FragColor=vec4(1.0,0.85,0.1,1.0); }';
  function makeGl(id, preserve) {
    const canvas = document.getElementById(id);
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: preserve, antialias: false, alpha: false });
    if (!gl) return null;
    function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0.5, -0.5, -0.5, 0.5, -0.5]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    const angle = gl.getUniformLocation(program, 'a');
    return { gl, program, loc, angle, canvas };
  }
  const g1 = makeGl('gl1', false);
  const g2 = makeGl('gl2', true);
  function renderGl(g, k) {
    if (!g) return;
    const gl = g.gl;
    gl.viewport(0, 0, g.canvas.width, g.canvas.height);
    gl.clearColor((k % 60) / 60, 0.2, 0.4, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(g.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.getParameter(gl.ARRAY_BUFFER_BINDING));
    gl.enableVertexAttribArray(g.loc);
    gl.vertexAttribPointer(g.loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(g.angle, k * 6 * Math.PI / 180);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
  }
  const renderer = (function () {
    if (!g1) return 'no webgl2';
    const info = g1.gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(g1.gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(g1.gl.getParameter(g1.gl.RENDERER));
  })();
  window.seek = function (k, fpsValue) {
    const animations = document.getAnimations();
    animations.forEach(function (a) { a.pause(); a.currentTime = k * 1000 / fpsValue; });
    renderGl(g1, k);
    renderGl(g2, k);
    const css = document.getElementById('css');
    const state = {
      count: animations.length,
      transform: getComputedStyle(css).transform,
      rectLeft: css.getBoundingClientRect().left,
      opacity: getComputedStyle(waapi).opacity,
      dpr: window.devicePixelRatio,
      fonts: document.fonts.status,
      renderer: renderer,
      webgl2: !!g1,
    };
    document.getElementById('readout').textContent = 'k=' + k + ' dpr=' + state.dpr + ' ' + state.fonts;
    return JSON.stringify(state);
  };
  window.seekReady = true;
})();
</script></body></html>`;

interface FlagSet {
  readonly name: string;
  readonly args: readonly string[];
  readonly repeats: number;
  readonly disabledAnimations?: boolean;
  readonly channel?: Channel;
}

const hardware = '--use-angle=d3d11';
const contentLevelDeterministic: readonly string[] = [
  '--run-all-compositor-stages-before-draw',
  '--disable-threaded-animation',
  '--disable-checker-imaging',
  '--disable-new-content-rendering-timeout',
  '--disable-image-animation-resync',
];

interface SeekState {
  readonly count: number;
  readonly transform: string;
  readonly rectLeft: number;
  readonly opacity: string;
  readonly dpr: number;
  readonly fonts: string;
  readonly renderer: string;
  readonly webgl2: boolean;
}

interface FrameRecord {
  readonly run: string;
  readonly k: number;
  readonly hash: string;
  readonly screenshotMs: number;
  readonly state: SeekState;
  readonly path: string;
  readonly redBoxLeftPx: number;
  /** Pixel inside the full-frame canvas created without preserveDrawingBuffer. */
  readonly gl1Pixel: string;
  /** Pixel inside the small canvas created with preserveDrawingBuffer: true. */
  readonly gl2Pixel: string;
}

/** Reads one row of RGB pixels from a PNG through ffmpeg and returns the x of the first strongly red pixel, or -1. */
async function redBoxLeft(pngPath: string, row: number): Promise<number> {
  const result = await runCommandBuffer(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', pngPath, '-vf', `crop=1920:1:0:${row}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeoutMs: 60_000 });
  const bytes = result.stdout;
  for (let x = 0; x < 1920; x += 1) {
    const r = bytes[x * 3] ?? 0;
    const g = bytes[x * 3 + 1] ?? 0;
    const b = bytes[x * 3 + 2] ?? 0;
    if (r > 200 && g < 80 && b < 80) return x;
  }
  return -1;
}

/** Reads a single pixel's RGB from a PNG through ffmpeg. */
async function pixelAt(pngPath: string, x: number, y: number): Promise<string> {
  const result = await runCommandBuffer(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', pngPath, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeoutMs: 60_000 });
  const b = result.stdout;
  return `${b[0] ?? 0},${b[1] ?? 0},${b[2] ?? 0}`;
}

async function captureRun(page: Page, runDir: string, runName: string, disabledAnimations: boolean): Promise<FrameRecord[]> {
  const records: FrameRecord[] = [];
  await page.evaluate('document.fonts.ready');
  for (const k of frames) {
    const stateJson = await page.evaluate<string>(`window.seek(${k}, ${fps})`);
    const state = JSON.parse(stateJson) as SeekState;
    const path = join(runDir, `f${String(k).padStart(2, '0')}.png`);
    const started = process.hrtime.bigint();
    await page.screenshot({ path, type: 'png', animations: disabledAnimations ? 'disabled' : 'allow', caret: 'hide', scale: 'css' });
    const screenshotMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    records.push({
      run: runName,
      k,
      hash: await framehash(path),
      screenshotMs,
      state,
      path,
      redBoxLeftPx: await redBoxLeft(path, 100),
      gl1Pixel: await pixelAt(path, 1900, 1000),
      gl2Pixel: await pixelAt(path, 1420, 380),
    });
  }
  return records;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return Number.NaN;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

/** Runs the probe and writes docs/evidence/m0/p5-determinism.md. */
export async function run(): Promise<void> {
  const report = new EvidenceReport('p5-determinism', 'P5: seek-based capture determinism');
  const dir = ensureDir(join(scratchDir, 'p5'));
  const siteDir = ensureDir(join(dir, 'site'));
  writeFileSync(join(siteDir, 'index.html'), pageHtml, 'utf8');
  report.facts(await machineFingerprint());
  const channels = availableChannels();
  const primary: Channel = channels[0] ?? 'msedge';
  const secondary: Channel | undefined = channels[1];
  const executable = primary === 'msedge' ? edgePath() : chromePath();
  report.paragraph(`Primary channel ${primary} ${executable === undefined ? '' : await windowsFileVersion(executable)}. Each run is a fresh persistent context (headless, 1920x1080, DPR 1). Frames ${frames.join(', ')} at ${fps} fps. Expected CSS box left edge per frame: ${frames.map((k) => `${k}:${((k * 1000 / fps) / 2000 * 800).toFixed(1)}px`).join(', ')}.`);

  const flagSets: FlagSet[] = [
    { name: 'A-hardware', args: [...baseArgs, hardware], repeats: 10 },
    { name: 'D-text-flags', args: [...baseArgs, hardware, '--disable-lcd-text', '--disable-font-subpixel-positioning'], repeats: 3 },
    { name: 'F-compositor-flags', args: [...baseArgs, hardware, ...contentLevelDeterministic], repeats: 3 },
    { name: 'E-software', args: [...baseArgs, '--use-angle=swiftshader-webgl'], repeats: 3 },
    { name: 'H-no-force-dsf', args: [hardware], repeats: 1 },
    { name: 'X-animations-disabled', args: [...baseArgs, hardware], repeats: 1, disabledAnimations: true },
  ];
  if (secondary !== undefined) flagSets.push({ name: `S-${secondary}`, args: [...baseArgs, hardware], repeats: 3, channel: secondary });

  const server = await startStaticServer([{ urlPrefix: '/site/', directory: siteDir }]);
  const all: FrameRecord[] = [];
  const runLog: string[][] = [];
  try {
    for (const flagSet of flagSets) {
      for (let i = 0; i < flagSet.repeats; i += 1) {
        const runName = `${flagSet.name}-${i + 1}`;
        const profile = profileDir(dir, runName);
        const runDir = ensureDir(join(dir, 'frames', runName));
        const launchStart = Date.now();
        const context = await launchContext({ channel: flagSet.channel ?? primary, profileDir: profile, args: flagSet.args });
        try {
          const page = await context.newPage();
          await page.goto(`${server.url}/site/index.html`, { waitUntil: 'load' });
          await page.waitForFunction('window.seekReady === true', undefined, { timeout: 20_000 });
          const records = await captureRun(page, runDir, runName, flagSet.disabledAnimations === true);
          all.push(...records);
          runLog.push([runName, `${Date.now() - launchStart} ms`, records[0]?.state.renderer ?? '', String(records[0]?.state.dpr ?? ''), records[0]?.state.fonts ?? '', String(records[0]?.state.count ?? '')]);
        } finally {
          await closeQuietly(context);
          await removeProfileDir(profile);
        }
      }
    }
  } finally {
    await server.close();
  }

  report.heading('Runs');
  report.table(['Run', 'Launch to first frame', 'Renderer', 'DPR', 'fonts.status', 'getAnimations().length'], runLog);

  // Hash table: one row per run, one column per frame.
  const runNames = [...new Set(all.map((r) => r.run))];
  report.heading('Pixel hashes (ffmpeg framehash sha256, first 16 hex)');
  report.table(['Run', ...frames.map((k) => `k=${k}`), 'median screenshot ms'], runNames.map((run) => {
    const own = all.filter((r) => r.run === run);
    return [run, ...frames.map((k) => own.find((r) => r.k === k)?.hash.slice(0, 16) ?? ''), median(own.map((r) => r.screenshotMs)).toFixed(1)];
  }));

  // Repeatability within each flag set.
  report.heading('Repeatability per flag set');
  const repeatRows: string[][] = [];
  for (const flagSet of flagSets) {
    if (flagSet.repeats < 2) continue;
    const perFrame = frames.map((k) => {
      const hashes = all.filter((r) => r.run.startsWith(`${flagSet.name}-`) && r.k === k).map((r) => r.hash);
      return `${new Set(hashes).size} distinct / ${hashes.length}`;
    });
    repeatRows.push([flagSet.name, String(flagSet.repeats), ...perFrame]);
  }
  report.table(['Flag set', 'Runs', ...frames.map((k) => `k=${k}`)], repeatRows);

  // Compare flag sets against A-hardware-1 at each frame.
  report.heading('Each flag set versus A-hardware-1');
  const reference = all.filter((r) => r.run === 'A-hardware-1');
  const cmpRows: string[][] = [];
  for (const flagSet of flagSets) {
    const run = `${flagSet.name}-1`;
    if (run === 'A-hardware-1') continue;
    for (const k of frames) {
      const a = reference.find((r) => r.k === k);
      const b = all.find((r) => r.run === run && r.k === k);
      if (a === undefined || b === undefined) continue;
      if (a.hash === b.hash) {
        cmpRows.push([run, String(k), 'identical', '', '']);
      } else {
        const cmp = await compareImages(a.path, b.path);
        cmpRows.push([run, String(k), 'different', cmp.ssim.toFixed(5), Number.isFinite(cmp.psnr) ? cmp.psnr.toFixed(2) : 'inf']);
      }
    }
  }
  report.table(['Run', 'k', 'Hash', 'SSIM', 'PSNR dB'], cmpRows);

  // Semantics: seeked value versus pixels, WebGL canvas presence, DPR.
  report.heading('Seek semantics on A-hardware-1 (and the animations:disabled control)');
  const semanticRows: string[][] = [];
  for (const run of ['A-hardware-1', 'X-animations-disabled-1', 'H-no-force-dsf-1']) {
    for (const record of all.filter((r) => r.run === run)) {
      const expectedLeft = (record.k * 1000 / fps) / 2000 * 800;
      const expectedClear = `${Math.round((record.k % 60) / 60 * 255)},51,102`;
      semanticRows.push([run, String(record.k), record.state.transform, String(record.state.rectLeft), `${expectedLeft.toFixed(1)} px`, `${record.redBoxLeftPx} px`, record.state.opacity, record.gl1Pixel, record.gl2Pixel, expectedClear, String(record.state.dpr)]);
    }
  }
  report.table(['Run', 'k', 'computed transform', 'rect.left', 'expected left', 'pixel left', 'WAAPI opacity', 'gl1 pixel (preserve off)', 'gl2 pixel (preserve on)', 'expected clear RGB', 'DPR'], semanticRows);

  // Timing budget.
  report.heading('Screenshot timing');
  const timingRows = flagSets.map((flagSet) => {
    const own = all.filter((r) => r.run.startsWith(`${flagSet.name}-`));
    const med = median(own.map((r) => r.screenshotMs));
    return [flagSet.name, med.toFixed(1), (med * 600 / 1000).toFixed(1), (med * 1800 / 1000).toFixed(1)];
  });
  report.table(['Flag set', 'median ms per 1080p screenshot', 'projected 600 frames (s)', 'projected 1800 frames (s)'], timingRows);

  // Keep one frame per interesting run in the evidence folder at reduced size.
  const evidenceDir = ensureDir(join(repoRoot, 'docs', 'evidence', 'm0', 'p5'));
  for (const run of ['A-hardware-1', 'E-software-1', 'X-animations-disabled-1']) {
    const record = all.find((r) => r.run === run && r.k === 15);
    if (record !== undefined && existsSync(record.path)) copyFileSync(record.path, join(dir, `${run}-k15.png`));
  }
  for (const run of ['A-hardware-1', 'E-software-1', 'X-animations-disabled-1']) {
    const source = join(dir, `${run}-k15.png`);
    if (!existsSync(source)) continue;
    const target = join(evidenceDir, `${run}-k15-480.png`);
    await runCommandBuffer(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vf', 'scale=480:-1', target], { timeoutMs: 60_000 });
  }

  report.heading('Conclusion');
  const aHashes = frames.map((k) => new Set(all.filter((r) => r.run.startsWith('A-hardware-') && r.k === k).map((r) => r.hash)).size);
  const aIdentical = aHashes.every((n) => n === 1);
  report.paragraph(aIdentical
    ? 'All hardware runs with identical flags produced identical pixel hashes for every frame: same-machine, same-fingerprint byte identity holds for this page.'
    : `Hardware runs with identical flags differed (distinct hashes per frame: ${aHashes.join(', ')}). The QA gate must use SSIM/PSNR; hash equality is only a cache hint.`);
  const a15 = all.find((r) => r.run === 'A-hardware-1' && r.k === 15);
  if (a15 !== undefined) {
    report.paragraph(`Compositor check at k=15: expected CSS box left 200.0 px, measured ${a15.redBoxLeftPx} px from pixels; computed transform ${a15.state.transform}.`);
    report.paragraph(`WebGL canvases at k=15: preserveDrawingBuffer:false sampled ${a15.gl1Pixel}, preserveDrawingBuffer:true sampled ${a15.gl2Pixel} (expected clear color ${Math.round(15 / 60 * 255)},51,102 for both).`);
  }
  report.paragraph(`Frames and profiles: \`${relative(repoRoot, dir)}\`; reduced k=15 frames under \`docs/evidence/m0/p5/\`.`);
  report.unverified('Cross-machine identity is out of scope by design; only same-machine runs were compared.');
  report.unverified('Three.js post-processing cost is not measured here; only the screenshot path.');
  const path = report.write();
  process.stdout.write(`wrote ${relative(repoRoot, path)}\n`);
}
