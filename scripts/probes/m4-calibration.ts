/**
 * M4 calibration probe (ADR 0008 decision 2): renders the calibration
 * scene in the html and three lanes under both tone mappings at 1920x1080
 * (the three lane also at 480x270, and with the built-in room environment
 * when an HDRI is installed, since the parity test runs without one),
 * measures every patch's YAVG and every swatch's hue, and writes
 * docs/evidence/m4/calibration.md with a table per render, the renderer
 * string, the ms per frame and a "Not verified" list. The html lane's flat
 * patches are the reference; the three lane's gray card is what the
 * scalars in src/shared/three/calibration-scalars.ts are tuned on.
 *
 * `node scripts/probes/run.ts m4-calibration`, with VF_PROBE_DATA_DIR
 * naming a data directory where `assets --fetch hdri:studio_small_09-1k`
 * has run; without it the three lane renders under its room environment.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StreamLogger, LogLevels } from '../../src/cli/logger.ts';
import { measurePatches, measureSwatchHues } from '../../src/calibration/measure.ts';
import type { PatchMeasurement, SwatchHueMeasurement } from '../../src/calibration/measure.ts';
import { machineFacts, probeBrowser, probeDataDir, probeFfmpeg, probeWorkDir, reducePng } from '../../src/calibration/probe-support.ts';
import { renderCalibrationStill } from '../../src/calibration/render-calibration.ts';
import type { CalibrationRenderResult } from '../../src/calibration/render-calibration.ts';
import { formatNumber, formatRgb, hueTable, markdownTable, notVerifiedSection, patchSummary, patchTable } from '../../src/calibration/report.ts';
import { lightingOfPreset } from '../../src/calibration/shots.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { ToneMapping } from '../../src/shared/contracts/look-bible.ts';
import type { BrowserLane } from '../../src/shared/harness/protocol.ts';
import { keyIntensityScalar, keyedEnvironmentIntensity, shadowKeyShare } from '../../src/shared/three/calibration-scalars.ts';
import { repoRoot } from './lib.ts';

/** One render of the probe. */
interface Run {
  readonly name: string;
  readonly lane: BrowserLane;
  readonly toneMapping: ToneMapping;
  readonly width: number;
  readonly height: number;
  /** Frames rendered after frame 0 for the timing; the html lane's cost is known from M3, so it gets fewer. */
  readonly timingFrames: number;
  /** True renders from an empty data directory, so the three lane takes its room environment whatever is installed. */
  readonly roomEnvironment: boolean;
}

/** What one run produced. */
interface RunResult {
  readonly run: Run;
  readonly render: CalibrationRenderResult;
  readonly patches: readonly PatchMeasurement[];
  readonly hues: readonly SwatchHueMeasurement[];
}

const evidenceDir = join(repoRoot, 'docs', 'evidence', 'm4');
const never = new AbortController().signal;
const lighting = lightingOfPreset('product-studio');

const runs: readonly Run[] = [
  { name: 'html agx 1920x1080', lane: 'html', toneMapping: 'agx', width: 1920, height: 1080, timingFrames: 2, roomEnvironment: false },
  { name: 'html standard 1920x1080', lane: 'html', toneMapping: 'standard', width: 1920, height: 1080, timingFrames: 2, roomEnvironment: false },
  { name: 'three agx 1920x1080', lane: 'three', toneMapping: 'agx', width: 1920, height: 1080, timingFrames: 4, roomEnvironment: false },
  { name: 'three standard 1920x1080', lane: 'three', toneMapping: 'standard', width: 1920, height: 1080, timingFrames: 4, roomEnvironment: false },
  { name: 'three agx 480x270', lane: 'three', toneMapping: 'agx', width: 480, height: 270, timingFrames: 4, roomEnvironment: false },
  { name: 'three standard 480x270', lane: 'three', toneMapping: 'standard', width: 480, height: 270, timingFrames: 4, roomEnvironment: false },
  { name: 'three agx 1920x1080 room environment', lane: 'three', toneMapping: 'agx', width: 1920, height: 1080, timingFrames: 0, roomEnvironment: true },
  { name: 'three standard 1920x1080 room environment', lane: 'three', toneMapping: 'standard', width: 1920, height: 1080, timingFrames: 0, roomEnvironment: true },
];

/** The file name a run's still is kept under. */
function stillName(run: Run): string {
  return `calibration-${run.lane}-${run.toneMapping}-${String(run.width)}x${String(run.height)}${run.roomEnvironment ? '-room' : ''}.png`;
}

/** The mean colour of a patch of a run as "r, g, b", or "n/a" when the run has no such patch. */
function meanRgbOf(result: RunResult, id: string): string {
  const row = result.patches.find((patch) => patch.id === id);
  return row === undefined ? 'n/a' : formatRgb(row.meanRgb);
}

/**
 * The reading note on the neutral patches' colour: the YAVG columns judge
 * luma alone, so a gray card whose red channel runs hot and blue low could
 * sit on 117 while not being gray. The three lane's lights are balanced to
 * the rig's key (whiteBalancedKelvinRgb in src/shared/look/css-tokens.ts,
 * ADR 0008 decision 2 as amended), so under the product-studio rig the
 * key is neutral and the neutral patches read with equal channels, as the
 * html lane's flat patches do by construction.
 */
function neutralCastNote(results: readonly RunResult[]): string {
  const rows = results.filter((result) => result.run.lane === 'three').map((result) => `${result.run.name}: gray card ${meanRgbOf(result, 'gray-18')}, white ${meanRgbOf(result, 'white-90')}, black ${meanRgbOf(result, 'black-2')}`);
  return [
    'Reading the Mean RGB column of the neutral patches: the html lane\'s gray card, white and black read with equal channels (its patches are flat sRGB fills), and so do the three lane\'s, because its lights are white-balanced to the rig\'s key (a 5600 K key renders neutral, a 3200 K fill under it warm, an 8000 K rim blue; `whiteBalancedKelvinRgb` in `src/shared/look/css-tokens.ts`). Before the balance the key\'s own black-body colour (255, 239, 225) tinted every surface warm and the gray card read about 125, 115, 109; the scalars were retuned after it. Per run:',
    '',
    ...rows.map((row) => `- ${row}`),
    '',
    'The gray-card gate holds the luma only; the channel spread is reported here so a tint would show.',
  ].join('\n');
}

/** The lines of one run's section. */
function runSection(result: RunResult): readonly string[] {
  const { run, render } = result;
  const environment = run.lane === 'html' ? 'none (flat patches)' : render.environment === null ? 'built-in room environment' : `${render.environment.id} (${render.environment.url})`;
  return [
    `### ${run.name}`,
    '',
    `Renderer ${render.webglRenderer} (${render.profile.renderer}, ${render.profile.backend}); environment ${environment}; launch ${formatNumber(render.launchMs, 0)} ms, init to frame 0 ${formatNumber(render.initMs, 0)} ms, ${render.msPerFrame === null ? 'no timing frames' : `${formatNumber(render.msPerFrame, 1)} ms per frame over ${String(run.timingFrames)} further frames`}.`,
    '',
    patchTable(result.patches),
    '',
    patchSummary(result.patches),
    '',
    hueTable(result.hues),
    '',
  ];
}

/** The probe's entry point. */
export async function run(): Promise<void> {
  const runner = new ChildProcessRunner();
  const log = new StreamLogger(LogLevels.normal);
  const browser = await probeBrowser(runner, never);
  const ffmpeg = await probeFfmpeg(runner, never);
  const dataDir = probeDataDir();
  const workRoot = probeWorkDir('calibration');
  const roomDataDir = ensureDirectory(join(workRoot, 'room-data'));
  const stillsDir = ensureDirectory(join(workRoot, 'stills'));
  mkdirSync(evidenceDir, { recursive: true });
  log.info(`calibration probe: ${browser.channel} ${browser.version}, data ${dataDir}, stills under ${stillsDir}`);

  const results: RunResult[] = [];
  for (const entry of runs) {
    const workDir = join(workRoot, 'work');
    rmSync(workDir, { recursive: true, force: true });
    const outPng = join(stillsDir, stillName(entry));
    log.info(`rendering ${entry.name}`);
    const render = await renderCalibrationStill({
      lane: entry.lane, toneMapping: entry.toneMapping, lighting, dataDir: entry.roomEnvironment ? roomDataDir : dataDir, outPng,
      width: entry.width, height: entry.height, timingFrames: entry.timingFrames, workDir, browser, policy: 'any', log, signal: never,
    });
    const measure = { runner, ffmpegPath: ffmpeg.path, png: outPng, width: entry.width, height: entry.height, workDir: join(workDir, 'measure'), signal: never };
    const patches = await measurePatches(measure);
    const hues = await measureSwatchHues(measure);
    log.info(`  ${patchSummary(patches)}`);
    results.push({ run: entry, render, patches, hues });
  }

  for (const result of results) {
    if (result.run.width === 1920 && !result.run.roomEnvironment) {
      await reducePng(runner, ffmpeg.path, result.render.png, join(evidenceDir, stillName(result.run).replace(/\.png$/, '-640.png')), 640, never);
    }
  }

  const lines: string[] = [
    '# M4 calibration: the gray card in both browser lanes',
    '',
    'Generated by `node scripts/probes/run.ts m4-calibration`. The calibration scene of `src/shared/calibration/scene.ts` (ADR 0008 decision 2) rendered by the html lane (flat patches, the reference) and the three lane (patches lit by the product-studio rig at the fixture\'s distance) under both tone mappings, raw frames with no grade, measured with the still gate\'s crop + signalstats filter (YAVG) and an area-averaged crop (mean RGB, hue).',
    '',
    markdownTable(['Fact', 'Value'], machineFacts(browser, ffmpeg.version)),
    '',
    '## Scalars in force',
    '',
    markdownTable(['Scalar', 'Value'], [
      ['keyIntensityScalar.agx', String(keyIntensityScalar.agx)],
      ['keyIntensityScalar.standard', String(keyIntensityScalar.standard)],
      ['shadowKeyShare', String(shadowKeyShare)],
      ['keyedEnvironmentIntensity', String(keyedEnvironmentIntensity)],
    ]),
    '',
    'The scalars tried on the way to these, with the gray card each gave, are in `calibration-tuning.md` beside this file.',
    '',
    '## Renders',
    '',
    neutralCastNote(results),
    '',
    'Reading the swatch rows: the html lane draws every swatch at exactly its hex (the Mean RGB column shows 204, 0, 0 for red) and its swatch YAVG rows meet the scene\'s expectation, because the measurement converts the RGB still with the BT.709 matrix the delivery is tagged with (`scale=out_color_matrix=bt709` in `boxLumaFilter`, `src/qa/text-contrast.ts`). With ffmpeg\'s BT.601 default the same swatches missed by up to 22 (red read 68 against 53); neutral patches read the same under either matrix.',
    '',
    ...results.flatMap(runSection),
    '## Summary',
    '',
    markdownTable(['Render', 'Gray card YAVG', 'White', 'Black', 'Within tolerance', 'ms per frame'], results.map((result) => {
      const by = (id: string): string => formatNumber(result.patches.find((row) => row.id === id)?.measuredYavg ?? null, 1);
      return [result.run.name, by('gray-18'), by('white-90'), by('black-2'), `${String(result.patches.filter((row) => row.ok).length)} of ${String(result.patches.length)}`, formatNumber(result.render.msPerFrame, 1)];
    })),
    '',
    notVerifiedSection([
      'Only the owner\'s machine (Windows, the hardware renderer) has run this probe; the software renderer (SwiftShader) and the Linux runner have not been measured.',
      'The scalars are set under the product-studio rig; the other fifteen rigs reuse them unmeasured, so a rig whose lights stand at another distance or size inherits whatever the d²/A rule gives it.',
      'The spheres and the 48 px text line are rendered but not measured: nothing here judges the highlight, the shading falloff or the type.',
      'The swatch hues are measured on the mean colour of each box; a swatch the tone map desaturates toward gray reports a hue that means less, which the saturation column shows.',
      'Nothing gates the channel spread of a neutral patch; the Mean RGB column is the evidence that the white balance holds, read by eye.',
    ]),
  ];
  const reportPath = join(evidenceDir, 'calibration.md');
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  log.info(`wrote ${reportPath}`);
}
