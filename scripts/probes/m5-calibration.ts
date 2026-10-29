/**
 * M5 calibration probe (ADR 0008 decision 2, the blender lane): renders
 * the calibration scene of src/shared/calibration/scene.ts through Blender
 * at 1920x1080 with Cycles on OptiX and EEVEE on OpenGL under both view
 * transforms, lit by the product-studio rig at the fixture's distance under
 * the studio HDRI (plus one Cycles pair under the flat world a machine
 * without the HDRI gets), measures every patch's YAVG and every swatch's
 * hue exactly as the M4 probe measured the browser lanes, and writes
 * docs/evidence/m5/calibration.md in that report's shape. The gray card's
 * number is what blenderKeyPowerW in src/shared/blender/calibration-scalars.ts
 * is tuned on; the trials that led to it are in calibration-tuning.md.
 *
 * `node scripts/probes/run.ts m5-calibration`, with VF_PROBE_DATA_DIR naming
 * a data directory where doctor and `assets --fetch hdri:studio_small_09-1k`
 * have run.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StreamLogger, LogLevels } from '../../src/cli/logger.ts';
import { measurePatches, measureSwatchHues } from '../../src/calibration/measure.ts';
import type { PatchMeasurement, SwatchHueMeasurement } from '../../src/calibration/measure.ts';
import { reducePng } from '../../src/calibration/probe-support.ts';
import { blenderCalibrationShot, renderBlenderStill } from '../../src/calibration/render-blender-still.ts';
import type { BlenderStillResult } from '../../src/calibration/render-blender-still.ts';
import { calibrationLook } from '../../src/calibration/render-calibration.ts';
import { formatNumber, formatRgb, hueTable, markdownTable, notVerifiedSection, patchSummary, patchTable } from '../../src/calibration/report.ts';
import { lightingOfPreset } from '../../src/calibration/shots.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import { ladderAttempt } from '../../src/lanes/blender/ladder.ts';
import type { LadderRung } from '../../src/lanes/blender/ladder.ts';
import { worldColourStrength } from '../../src/lanes/blender/world.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { blenderHdriPath } from '../../src/render/environment.ts';
import { blenderCalibrationDistanceM, blenderKeyPowerW, blenderKeyedHdriStrength } from '../../src/shared/blender/calibration-scalars.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import type { ToneMapping } from '../../src/shared/contracts/look-bible.ts';
import { formatSeconds } from './m5-report.ts';
import { m5DataDir, m5EvidenceDir, m5MachineFacts, m5Tools, m5WorkDir, never } from './m5-support.ts';

/** One render of the probe. */
interface Run {
  readonly name: string;
  readonly rung: LadderRung;
  readonly toneMapping: ToneMapping;
  /** True renders with no HDRI, the flat world in the look's background colour. */
  readonly flatWorld: boolean;
}

/** What one run produced. */
interface RunResult {
  readonly run: Run;
  readonly render: BlenderStillResult;
  readonly samples: number;
  readonly hdri: string | null;
  readonly patches: readonly PatchMeasurement[];
  readonly hues: readonly SwatchHueMeasurement[];
}

const spec: RenderSpec = { fps: 30, width: 1920, height: 1080 };
const lighting = lightingOfPreset('product-studio');
const cyclesOptix: LadderRung = { engine: 'cycles', backend: 'OPTIX' };
const eeveeOpengl: LadderRung = { engine: 'eevee', backend: 'opengl' };

const runs: readonly Run[] = [
  { name: 'cycles OPTIX agx 1920x1080', rung: cyclesOptix, toneMapping: 'agx', flatWorld: false },
  { name: 'cycles OPTIX standard 1920x1080', rung: cyclesOptix, toneMapping: 'standard', flatWorld: false },
  { name: 'eevee opengl agx 1920x1080', rung: eeveeOpengl, toneMapping: 'agx', flatWorld: false },
  { name: 'eevee opengl standard 1920x1080', rung: eeveeOpengl, toneMapping: 'standard', flatWorld: false },
  { name: 'cycles OPTIX agx 1920x1080 flat world', rung: cyclesOptix, toneMapping: 'agx', flatWorld: true },
  { name: 'cycles OPTIX standard 1920x1080 flat world', rung: cyclesOptix, toneMapping: 'standard', flatWorld: true },
];

/** The file name a run's still is kept under. */
function stillName(run: Run): string {
  return `calibration-blender-${run.rung.engine}-${run.rung.backend}-${run.toneMapping}-${String(spec.width)}x${String(spec.height)}${run.flatWorld ? '-flat' : ''}.png`;
}

/** The mean colour of a patch of a run as "r, g, b", or "n/a" when the run has no such patch. */
function meanRgbOf(result: RunResult, id: string): string {
  const row = result.patches.find((patch) => patch.id === id);
  return row === undefined ? 'n/a' : formatRgb(row.meanRgb);
}

/** The reading note on the neutral patches' colour: the lights are balanced to the key, so a tint would show here and not in the luma. */
function neutralCastNote(results: readonly RunResult[]): string {
  return [
    'Reading the Mean RGB column of the neutral patches: the lights are white-balanced to the rig\'s key (`whiteBalancedKelvinRgb`, ADR 0008 decision 2 as amended), written as the light\'s colour with `use_temperature` off (`src/lanes/blender/lights.ts`), so the 5600 K key renders neutral and the gray card, white and black read with equal channels, as the html lane\'s flat patches and the three lane\'s lit ones do. Per run:',
    '',
    ...results.map((result) => `- ${result.run.name}: gray card ${meanRgbOf(result, 'gray-18')}, white ${meanRgbOf(result, 'white-90')}, black ${meanRgbOf(result, 'black-2')}`),
    '',
    'The gray-card gate holds the luma only; the channel spread is reported here so a tint would show.',
  ].join('\n');
}

/** The lines of one run's section. */
function runSection(result: RunResult): readonly string[] {
  const { run, render } = result;
  return [
    `### ${run.name}`,
    '',
    `Attempt ${render.profile.engine} on ${render.profile.backend} (${render.profile.renderer}), ${String(result.samples)} samples, denoised as a still; world ${result.hdri === null ? `flat, the look's background colour at ${String(worldColourStrength)}` : `${result.hdri} at strength ${String(blenderKeyedHdriStrength)}, turned toward the key`}; ${formatSeconds(render.elapsedMs)} from the call to the frame hashed (Blender's start${run.rung.engine === 'eevee' ? ' and the EEVEE shader compile' : ''} included).`,
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
  const dataDir = m5DataDir();
  const tools = m5Tools(dataDir);
  const workRoot = m5WorkDir('calibration');
  const stillsDir = ensureDirectory(join(workRoot, 'stills'));
  ensureDirectory(m5EvidenceDir);
  const shot = blenderCalibrationShot(lighting, spec);
  const hdri = blenderHdriPath(shot, dataDir);
  log.info(`calibration probe: Blender ${tools.blender.version}, data ${dataDir}, HDRI ${hdri ?? 'none installed'}, stills under ${stillsDir}`);

  const results: RunResult[] = [];
  for (const entry of runs) {
    const workDir = join(workRoot, 'work');
    rmSync(workDir, { recursive: true, force: true });
    const outPng = join(stillsDir, stillName(entry));
    const attempt = ladderAttempt(entry.rung, 'still', spec.width);
    log.info(`rendering ${entry.name}`);
    const render = await renderBlenderStill({
      shot, look: calibrationLook(entry.toneMapping), spec, frame: 0, attempt, tools, dataDir, hdriPath: entry.flatWorld ? null : hdri, scene: 'calibration',
      outPng, workDir, runner, log, signal: never,
    });
    const measure = { runner, ffmpegPath: tools.ffmpeg.path, png: outPng, width: spec.width, height: spec.height, workDir: join(workDir, 'measure'), signal: never };
    const patches = await measurePatches(measure);
    const hues = await measureSwatchHues(measure);
    log.info(`  ${patchSummary(patches)}`);
    results.push({ run: entry, render, samples: attempt.attempt.samples, hdri: entry.flatWorld ? null : hdri, patches, hues });
  }

  for (const result of results) {
    if (!result.run.flatWorld) await reducePng(runner, tools.ffmpeg.path, result.render.png, join(m5EvidenceDir, stillName(result.run).replace(/\.png$/, '-640.png')), 640, never);
  }

  const lines: string[] = [
    '# M5 calibration: the gray card in the blender lane',
    '',
    `Generated by \`node scripts/probes/run.ts m5-calibration\`. The calibration scene of \`src/shared/calibration/scene.ts\` (ADR 0008 decision 2) rendered by Blender through the production path (\`src/calibration/render-blender-still.ts\` over \`src/render/blender-shot.ts\`): the patches as one-face meshes and the spheres on the anchor plane (\`src/lanes/blender/calibration.ts\`), lit by the product-studio rig as area lights at the fixture's distance (\`src/lanes/blender/lights.ts\`), under both view transforms with Cycles on OptiX and EEVEE on OpenGL, raw frames with no grade, measured with the still gate's crop + signalstats filter (YAVG, BT.709) and an area-averaged crop (mean RGB, hue), as \`docs/evidence/m4/calibration.md\` measured the browser lanes. The html lane's flat patches there are the reference (gray card 117.0).`,
    '',
    markdownTable(['Fact', 'Value'], m5MachineFacts(tools)),
    '',
    '## Scalars in force',
    '',
    markdownTable(['Scalar', 'Value'], [
      ['blenderKeyPowerW.agx', `${String(blenderKeyPowerW.agx)} W`],
      ['blenderKeyPowerW.standard', `${String(blenderKeyPowerW.standard)} W`],
      ['blenderCalibrationDistanceM', `${String(blenderCalibrationDistanceM)} m`],
      ['blenderKeyedHdriStrength', String(blenderKeyedHdriStrength)],
    ]),
    '',
    'A light\'s power is its relative intensity × blenderKeyPowerW × (d / 1.2)² (the irradiance rule of ADR 0008 decision 2); the scalars tried on the way to these, with the gray card each gave, are in `calibration-tuning.md` beside this file.',
    '',
    '## Renders',
    '',
    neutralCastNote(results),
    '',
    'Reading the swatch rows: the swatch YAVG rows are measured with the BT.709 matrix the delivery is tagged with (`scale=out_color_matrix=bt709`), as in M4; a swatch the view transform desaturates reports a hue that means less, which the saturation column shows.',
    '',
    ...results.flatMap(runSection),
    '## Summary',
    '',
    markdownTable(['Render', 'Gray card YAVG', 'White', 'Black', 'Within tolerance', 'Render time'], results.map((result) => {
      const by = (id: string): string => formatNumber(result.patches.find((row) => row.id === id)?.measuredYavg ?? null, 1);
      return [result.run.name, by('gray-18'), by('white-90'), by('black-2'), `${String(result.patches.filter((row) => row.ok).length)} of ${String(result.patches.length)}`, formatSeconds(result.render.elapsedMs)];
    })),
    '',
    'For comparison the three lane (M4, the same rig, the same HDRI) reads gray card 116.6 / 117.2, white 173.0 / 211.0 and black 57.0 / 61.2 under agx / standard.',
    '',
    notVerifiedSection([
      'Only the owner\'s machine (Windows 11, RTX 2060, Blender 5.2.3) has run this probe; EEVEE on Vulkan, Cycles on CUDA and Cycles on the CPU are not measured here, and the acceptance evidence covers them only as one-frame renders of the bottle.',
      'The scalar is set under the product-studio rig; the other fifteen rigs reuse it unmeasured, so a rig whose lights stand at another distance or size inherits whatever the d² rule gives it.',
      'The spheres and the 48 px text line are rendered but not measured (the text line belongs to the html lane and is absent here); nothing judges the highlight or the shading falloff.',
      'The HDRI strength (0.05) was taken from the three lane and checked only on the gray card and the black patch under the one installed HDRI; the 2k HDRI and the other fifteen HDRIs are not installed.',
      'Nothing gates the channel spread of a neutral patch; the Mean RGB column is the evidence that the white balance holds, read by eye.',
    ]),
  ];
  const reportPath = join(m5EvidenceDir, 'calibration.md');
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  log.info(`wrote ${reportPath}`);
}
