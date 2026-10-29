/**
 * M5 lookdev probe: the Blender column of the lookdev sheet. For each of
 * the seven look presets the fixture's s01 product shot at frame 45 is
 * rendered on the blender lane at 960x540 with Cycles on OptiX (64
 * samples, denoised) under the look's default rig, graded by the still
 * finishing, and tiled beside the html and three stills of the M4 sheet
 * (re-rendered here through the same harness path, so every still on the
 * sheet is from one run) into docs/evidence/m5/lookdev-sheet.png: three
 * columns, html, three, blender, one row per look. lookdev.md holds each
 * finished still's YAVG against the look's band, the render time, one
 * sentence per Blender still written after looking at the sheet, and a
 * comparison of the three and blender columns with numbers.
 *
 * `node scripts/probes/run.ts m5-lookdev`, with VF_PROBE_DATA_DIR naming a
 * data directory where doctor and `assets --fetch hdri:studio_small_09-1k`
 * have run.
 */
import { rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StreamLogger, LogLevels } from '../../src/cli/logger.ts';
import { measureMeanRgb } from '../../src/calibration/measure.ts';
import { probeBrowser } from '../../src/calibration/probe-support.ts';
import { renderBlenderStill } from '../../src/calibration/render-blender-still.ts';
import { renderStill } from '../../src/calibration/render-still.ts';
import type { StillRenderResult } from '../../src/calibration/render-still.ts';
import { formatNumber, formatRgb, markdownTable, notVerifiedSection } from '../../src/calibration/report.ts';
import { focusedAtSubject, lightingOfPreset } from '../../src/calibration/shots.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import { ladderAttempt } from '../../src/lanes/blender/ladder.ts';
import type { LadderAttempt } from '../../src/lanes/blender/ladder.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { blenderHdriPath } from '../../src/render/environment.ts';
import { resolveEnvironment } from '../../src/render/environment.ts';
import { finishStill } from '../../src/render/finish-still.ts';
import { buildShotPageSpec } from '../../src/render/shot-page-spec.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import type { Rgb255 } from '../../src/shared/color/hue.ts';
import type { LookBible } from '../../src/shared/contracts/look-bible.ts';
import type { Shot } from '../../src/shared/contracts/shot-spec.ts';
import type { BrowserLane } from '../../src/shared/harness/protocol.ts';
import { lookPresetNames, lookPresets } from '../../src/shared/look/presets.ts';
import type { NamedLookPreset } from '../../src/shared/look/presets.ts';
import { buildContactSheet } from '../../src/sheet/contact-sheet.ts';
import { planShotSpec } from '../../tests/plan/fixtures.ts';
import { formatSeconds, lookdevTable } from './m5-report.ts';
import type { LookdevRow } from './m5-report.ts';
import { lookdevBlenderShot, m5DataDir, m5EvidenceDir, m5MachineFacts, m5Tools, m5WorkDir, never, pngYavg } from './m5-support.ts';

/** What the Blender still of each look shows, one sentence each, written after looking at the sheet. */
const blenderObservations: Readonly<Record<NamedLookPreset, string>> = {
  'studio-clean': 'The black bottle on a white cyc with the HDRI\'s softbox mirrored down its body and the metal cap burning to white; a long soft shadow runs camera-left across the floor and the wall grades to a mid gray at the top, darker than the three still\'s wall.',
  obsidian: 'A pale bottle lit from the upper right, its lower half falling into shadow and a long shadow stretching left on a floor that drops to black; 9 code values darker than the three still, which shows almost no shadow.',
  'warm-editorial': 'A warm beige set, the dark bottle with the key\'s broad highlight along its right flank and a soft shadow to the left; the closest match of the seven, within one code value of the three still and a touch warmer (less blue in the mean).',
  'neon-tech': 'A deep-blue floor and wall with the pale bottle taking a magenta sheen on its upper left and a cyan edge on its right; the rims stay on the bottle and nothing blooms, since Blender renders no halation pass.',
  'paper-flat': 'The slate bottle on a white cyc, the floor bright under it, a soft shadow to the left and the wall grading to gray at the top; even and plain, within 3 code values of the three still.',
  'noir-title': 'A dark bottle lit from camera-right with its left half black, one highlight on the cap and a thin reflection down the body; harder and darker than the three still\'s evenly gray bottle (23 against 30).',
  'sunset-gradient': 'An amber key low from the right puts an orange highlight down the bottle\'s right flank over a violet floor, with a long shadow to the left; more contrasty than the three still, whose bottle is evenly lavender.',
};

const spec: RenderSpec = { fps: 30, width: 960, height: 540 };
const stillFrame = 45;
const blenderSamples = 64;

/** One finished still of the sheet. */
interface LookStill {
  readonly look: NamedLookPreset;
  readonly lane: BrowserLane | 'blender';
  readonly finished: string;
  readonly environment: string;
  readonly yavg: number | null;
  /** The whole still's mean colour, for the lane comparison. */
  readonly meanRgb: Rgb255;
  /** The blender still's render time, or the browser still's ms per frame when it was timed. */
  readonly elapsedMs: number | null;
  readonly browser: StillRenderResult | null;
}

/** The fixture shot of a browser lane as the M4 lookdev renders it: s03 for html as it is, s01 for three with the look's default rig and the lens focused on the bottle. */
function browserFixtureShot(lane: BrowserLane, look: LookBible): Shot {
  const shot = planShotSpec.shots.find((candidate) => candidate.lane === lane);
  if (shot === undefined) throw new Error(`The plan fixture has no ${lane} shot.`);
  return lane === 'three' ? focusedAtSubject({ ...shot, lighting: lightingOfPreset(look.lightingDefault) }, spec) : shot;
}

/** The Cycles OptiX attempt of a still at the sheet's sample count: enough for a denoised 960x540 still, a quarter of the production still's 128. */
function sheetAttempt(): LadderAttempt {
  const base = ladderAttempt({ engine: 'cycles', backend: 'OPTIX' }, 'still', spec.width);
  return { ...base, attempt: { ...base.attempt, samples: blenderSamples } };
}

/** The still of a look on a lane, or undefined. */
function stillOf(stills: readonly LookStill[], look: NamedLookPreset, lane: LookStill['lane']): LookStill | undefined {
  return stills.find((still) => still.look === look && still.lane === lane);
}

/** A look with both 3D stills measured: the blender YAVG minus the three YAVG and both stills. */
interface LanePair {
  readonly look: NamedLookPreset;
  readonly delta: number;
  readonly three: LookStill;
  readonly blender: LookStill;
}

/** The looks whose three and blender stills both have a luma, in the presets' order. */
function lanePairs(stills: readonly LookStill[]): readonly LanePair[] {
  return lookPresetNames.flatMap((look) => {
    const three = stillOf(stills, look, 'three');
    const blender = stillOf(stills, look, 'blender');
    return three !== undefined && blender !== undefined && three.yavg !== null && blender.yavg !== null ? [{ look, delta: blender.yavg - three.yavg, three, blender }] : [];
  });
}

/** The comparison paragraph: what Blender adds, then the exposure and colour differences with the measured numbers (the smallest and the largest luma gap, warm-editorial's red and blue means) so a re-run cannot leave stale numbers in the sentences. */
function comparisonParagraph(stills: readonly LookStill[]): string {
  const pairs = [...lanePairs(stills)].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  const least = pairs[0];
  const most = pairs[pairs.length - 1];
  const exposure = least === undefined || most === undefined ? 'The exposure difference is not measured (a lane has no luma).' : `On exposure the Blender still is darker than the three still on every look, by ${formatNumber(Math.abs(least.delta), 1)} (${least.look}) to ${formatNumber(Math.abs(most.delta), 1)} (${most.look}) code values: the gray card agrees within 3 code values (\`calibration.md\`), so the difference is the shadows and the lower half of the bottle falling off under the key, not the light scalar; it is largest on the dark looks whose fill is weakest (obsidian 12:1, noir-title 16:1).`;
  const warm = pairs.find((pair) => pair.look === 'warm-editorial');
  const colour = warm === undefined ? 'The colour difference is not measured (warm-editorial has no luma on a lane).' : `On colour every look but one shifts all three channels down together with the luma; warm-editorial is the one look whose balance differs, the Blender still warmer (red ${String(warm.blender.meanRgb.r)} against ${String(warm.three.meanRgb.r)}, blue ${String(warm.blender.meanRgb.b)} against ${String(warm.three.meanRgb.b)}); the window rig's 3200 K fill is warm in both lanes, and which lane renders its warmth right is not measured here.`;
  return `What Blender adds over the three lane on this sheet, read off the thumbnails: a true soft shadow from the key on every look (long, to camera-left, with a soft edge; the three lane casts one shadow from a directional stand-in at 0.6 of the key and it barely shows on the dark looks); real reflections of the HDRI's softbox and the lights in the bottle's coat and in the cap, which burns to white on studio-clean; and the cyc's falloff by light transport, so the wall grades to gray at the top while the floor stays bright under the bottle. What it lacks: the halation pass (neon-tech blooms on the three still and not on the Blender one) and the motes, which are the three lane's seeded points. ${exposure} ${colour} The two stills outside their look's band on the Blender column are the two outside it on the three column (studio-clean, sunset-gradient), the question for the owner that \`docs/evidence/m4/lookdev.md\` already lists.`;
}

/** The lane comparison rows: per look the three and blender YAVG, their difference and both mean colours. */
function comparisonTable(stills: readonly LookStill[]): string {
  return markdownTable(['Look', 'three YAVG', 'blender YAVG', 'blender − three', 'three mean RGB', 'blender mean RGB'], lookPresetNames.map((name) => {
    const three = stillOf(stills, name, 'three');
    const blender = stillOf(stills, name, 'blender');
    const delta = three?.yavg !== null && three?.yavg !== undefined && blender?.yavg !== null && blender?.yavg !== undefined ? blender.yavg - three.yavg : null;
    return [name, formatNumber(three?.yavg ?? null, 1), formatNumber(blender?.yavg ?? null, 1), formatNumber(delta, 1, true), three === undefined ? 'n/a' : formatRgb(three.meanRgb), blender === undefined ? 'n/a' : formatRgb(blender.meanRgb)];
  }));
}

/** The probe's entry point. */
export async function run(): Promise<void> {
  const runner = new ChildProcessRunner();
  const log = new StreamLogger(LogLevels.normal);
  const dataDir = m5DataDir();
  const tools = m5Tools(dataDir);
  const browser = await probeBrowser(runner, never);
  const workRoot = m5WorkDir('lookdev');
  const stillsDir = ensureDirectory(join(workRoot, 'stills'));
  ensureDirectory(m5EvidenceDir);
  log.info(`lookdev probe: Blender ${tools.blender.version}, ${browser.channel} ${browser.version}, data ${dataDir}, stills under ${stillsDir}`);

  const stills: LookStill[] = [];
  const measureWhole = async (png: string, workDir: string): Promise<{ readonly yavg: number | null; readonly meanRgb: Rgb255 }> => {
    ensureDirectory(workDir);
    const options = { runner, ffmpegPath: tools.ffmpeg.path, png, width: spec.width, height: spec.height, workDir, signal: never };
    const yavg = await pngYavg(runner, tools.ffmpeg.path, png, join(workDir, 'yavg.txt'));
    const meanRgb = await measureMeanRgb(options, { x: 0, y: 0, w: spec.width, h: spec.height }, join(workDir, 'mean.rgb'));
    return { yavg, meanRgb };
  };
  for (const [index, name] of lookPresetNames.entries()) {
    const look = lookPresets[name];
    for (const lane of ['html', 'three', 'blender'] as const) {
      const workDir = join(workRoot, 'work');
      rmSync(workDir, { recursive: true, force: true });
      ensureDirectory(workDir);
      const raw = join(stillsDir, `${name}-${lane}.raw.png`);
      const finished = join(stillsDir, `${name}-${lane}.png`);
      let environment = 'none';
      let elapsedMs: number | null = null;
      let browserResult: StillRenderResult | null = null;
      if (lane === 'blender') {
        const shot = lookdevBlenderShot(look, spec);
        const hdri = blenderHdriPath(shot, dataDir);
        environment = hdri === null ? 'flat world' : 'hdri:studio_small_09-1k';
        log.info(`rendering ${name} blender (${shot.lighting.preset}, cycles OPTIX ${String(blenderSamples)} samples)`);
        const render = await renderBlenderStill({ shot, look, spec, frame: stillFrame, attempt: sheetAttempt(), tools, dataDir, hdriPath: hdri, outPng: raw, workDir: join(workDir, 'blender'), runner, log, signal: never });
        elapsedMs = render.elapsedMs;
      } else {
        const shot = browserFixtureShot(lane, look);
        const environmentRef = lane === 'three' ? resolveEnvironment(shot, dataDir) : null;
        environment = lane === 'html' ? 'none' : environmentRef === null ? 'room environment' : environmentRef.id;
        log.info(`rendering ${name} ${lane} (${lane === 'three' ? shot.lighting.preset : 'title card'})`);
        browserResult = await renderStill({ spec: buildShotPageSpec(shot, look, spec, environmentRef), frame: stillFrame, timingFrames: index === 0 ? 4 : 0, outPng: raw, dataDir, workDir: join(workDir, 'browser'), browser, policy: 'any', log, signal: never });
        elapsedMs = browserResult.msPerFrame;
      }
      await finishStill(runner, tools.ffmpeg.path, raw, finished, look, never);
      const measured = await measureWhole(finished, join(workDir, 'measure'));
      stills.push({ look: name, lane, finished, environment, yavg: measured.yavg, meanRgb: measured.meanRgb, elapsedMs, browser: browserResult });
    }
  }

  const sheetPath = join(m5EvidenceDir, 'lookdev-sheet.png');
  // 384 px thumbnails scale a 16:9 still to exactly 216 px; at 400 px the scale rounds the height to 226 and gives the thumbnails a sample aspect ratio of 226:225, which concat then refuses ("Invalid argument"; a setsar=1 after the scale in contact-sheet.ts would lift the limit).
  const sheet = await buildContactSheet(runner, tools.ffmpeg.path, { frames: stills.map((still) => ({ path: still.finished, label: `${still.look} ${still.lane}` })), columns: 3, thumbWidth: 384, output: sheetPath }, never);
  const sheetBytes = statSync(sheetPath).size;
  log.info(`wrote ${sheet.outputPath} (${String(sheet.count)} stills, ${String(sheet.columns)}x${String(sheet.rows)}, ${String(sheetBytes)} bytes)`);

  const rows: LookdevRow[] = lookPresetNames.map((name) => {
    const look = lookPresets[name];
    return { look: name, toneMapping: look.toneMapping, yavgMin: look.qa.yavgMin, yavgMax: look.qa.yavgMax, htmlYavg: stillOf(stills, name, 'html')?.yavg ?? null, threeYavg: stillOf(stills, name, 'three')?.yavg ?? null, blenderYavg: stillOf(stills, name, 'blender')?.yavg ?? null, blenderMs: stillOf(stills, name, 'blender')?.elapsedMs ?? 0 };
  });
  const blenderStills = stills.filter((still) => still.lane === 'blender');
  const meanBlenderMs = blenderStills.reduce((sum, still) => sum + (still.elapsedMs ?? 0), 0) / Math.max(1, blenderStills.length);
  const timed = stills.filter((still) => still.lane !== 'blender' && still.elapsedMs !== null);
  const outside = rows.filter((row) => row.blenderYavg === null || row.blenderYavg < row.yavgMin || row.blenderYavg > row.yavgMax);
  const lines: string[] = [
    '# M5 lookdev: the seven looks with the Blender column',
    '',
    `Generated by \`node scripts/probes/run.ts m5-lookdev\`. \`lookdev-sheet.png\` tiles twenty-one stills at ${String(spec.width)}x${String(spec.height)} in three columns, html, three and blender, one row per look of \`src/shared/look/presets.ts\` in the table's order: the fixture's s03 title card on the html lane, the fixture's s01 product shot at frame ${String(stillFrame)} on the three lane and on the blender lane, both under the look's default rig with the lens refocused onto the bottle (\`focusedAtSubject\`), every still graded by the look's LUT and vignette (no grain, as a still is). The Blender stills are Cycles on OptiX at ${String(blenderSamples)} samples, denoised, through the production path (\`src/calibration/render-blender-still.ts\`); the html and three stills are re-rendered here through the M4 harness path so the whole sheet comes from one run (${String(sheetBytes)} bytes).`,
    '',
    markdownTable(['Fact', 'Value'], [...m5MachineFacts(tools), ['Browser', `${browser.channel} ${browser.version}`], ['WebGL renderer', stills.find((still) => still.browser !== null)?.browser?.webglRenderer ?? '']]),
    '',
    '## The looks',
    '',
    lookdevTable(rows),
    '',
    `The YAVG columns measure the whole finished still as the still gate does (BT.709, limited range); a title card is mostly background, so its luma sits near the background's, and the band judges picture plates rather than type plates. Blender stills outside their look's QA band: ${outside.length === 0 ? 'none' : outside.map((row) => `${row.look} (${formatNumber(row.blenderYavg, 1)} against ${String(row.yavgMin)} to ${String(row.yavgMax)})`).join(', ')}. These are BT.709 lumas, the still gate's filter; the M4 sheet measured the same html and three stills with ffmpeg's BT.601 default, so its saturated looks read up to 6 higher there (sunset-gradient html 48.9 in \`docs/evidence/m4/lookdev.md\`, ${formatNumber(stillOf(stills, 'sunset-gradient', 'html')?.yavg ?? null, 1)} here).`,
    '',
    '## What the Blender stills show',
    '',
    markdownTable(['Look', 'Rig', 'Environment', 'Blender still'], lookPresetNames.map((name) => [name, lookPresets[name].lightingDefault, stillOf(stills, name, 'blender')?.environment ?? '', blenderObservations[name]])),
    '',
    '## three against blender',
    '',
    comparisonTable(stills),
    '',
    comparisonParagraph(stills),
    '',
    '## Cost per frame',
    '',
    markdownTable(['Lane', 'Measured'], [
      ['blender', `${formatSeconds(meanBlenderMs)} per still at ${String(spec.width)}x${String(spec.height)}, Cycles OptiX ${String(blenderSamples)} samples denoised, Blender's start included (mean of the seven; ${blenderStills.map((still) => `${still.look} ${formatSeconds(still.elapsedMs ?? 0)}`).join(', ')})`],
      ...timed.map((still) => [still.lane, `${formatNumber(still.elapsedMs, 1)} ms per frame at ${String(spec.width)}x${String(spec.height)} (${still.look}, ${still.lane === 'three' ? 'four sub-frames, SSAA level 2' : 'style writes and screenshot'})`]),
    ]),
    '',
    notVerifiedSection([
      'The sentences above are one reader\'s look at a 384 px thumbnail of each still; nobody has scored them against the vision rubric (M7).',
      'Only studio_small_09 (the product-studio family) is installed here, so the two looks on that family (studio-clean, paper-flat) render under it and the other five under the flat world in the look\'s background colour (the Environment column above), while the three stills of those rigs render under the room environment; the sheet changes once brown_photostudio_02, studio_small_03 and kloofendal_48d are fetched.',
      'The Blender stills are Cycles at 64 samples; the still command renders a 960x540 still through the ladder (EEVEE first) at 128 samples, so a still from the command differs from the sheet.',
      'The Blender stills use the fixture\'s s01 refocused on the bottle; no look has been rendered on another subject, move or size.',
    ]),
  ];
  const reportPath = join(m5EvidenceDir, 'lookdev.md');
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  log.info(`wrote ${reportPath}`);
}
