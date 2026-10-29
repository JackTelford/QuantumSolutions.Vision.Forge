/**
 * M4 lookdev probe: one html still (the fixture's s03 title card) and one
 * three still (the fixture's s01 product shot at frame 45 under the look's
 * default rig) for each of the seven look presets, rendered at 960x540
 * through the real harness and graded by the still finishing, tiled into
 * docs/evidence/m4/lookdev-sheet.png and described in lookdev.md: the
 * look's lighting, type and tone map, the finished still's YAVG against
 * the look's QA band, the ms per frame per lane, what the stills show and
 * the questions the owner decides. The sentences and the questions are
 * data at the top of this file, written after looking at the sheet.
 *
 * `node scripts/probes/run.ts m4-lookdev`, with VF_PROBE_DATA_DIR naming a
 * data directory whose installed HDRIs the three stills may use.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StreamLogger, LogLevels } from '../../src/cli/logger.ts';
import { machineFacts, probeBrowser, probeDataDir, probeFfmpeg, probeWorkDir } from '../../src/calibration/probe-support.ts';
import { renderStill } from '../../src/calibration/render-still.ts';
import type { StillRenderResult } from '../../src/calibration/render-still.ts';
import { formatNumber, markdownTable, notVerifiedSection } from '../../src/calibration/report.ts';
import { focusedAtSubject, lightingOfPreset } from '../../src/calibration/shots.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { runAnalysis } from '../../src/qa/check.ts';
import { exposureFilter } from '../../src/qa/exposure.ts';
import { parseSignalstatsYavg } from '../../src/qa/parse.ts';
import { resolveEnvironment } from '../../src/render/environment.ts';
import { finishStill } from '../../src/render/finish-still.ts';
import { buildShotPageSpec } from '../../src/render/shot-page-spec.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import type { LookBible } from '../../src/shared/contracts/look-bible.ts';
import type { Shot } from '../../src/shared/contracts/shot-spec.ts';
import type { BrowserLane } from '../../src/shared/harness/protocol.ts';
import { lookPresetNames, lookPresets } from '../../src/shared/look/presets.ts';
import type { NamedLookPreset } from '../../src/shared/look/presets.ts';
import { buildContactSheet } from '../../src/sheet/contact-sheet.ts';
import { planShotSpec } from '../../tests/plan/fixtures.ts';
import { repoRoot } from './lib.ts';

/** What the two stills of a look show, one sentence each, written after looking at the sheet. */
const observations: Readonly<Record<NamedLookPreset, { readonly html: string; readonly three: string }>> = {
  'studio-clean': {
    html: 'A near-white card with the dark bottle stand-in casting a soft shadow down-left and the heavy Inter title bottom-left; clean and a touch cool.',
    three: 'The black bottle sharp on a white cyc, its silver cap holding the highlight of the key and a soft shadow falling left; the floor burns to white where the cyc curves up toward the camera.',
  },
  obsidian: {
    html: 'A near-black field with the pale bottle lit from the upper right and faint motes; the Space Grotesk title in warm off-white reads easily.',
    three: 'A pale gray bottle in a dark room under the low-key rig, lit faintly from the upper right with motes behind it; the floor fades to black and the frame stays low in contrast.',
  },
  'warm-editorial': {
    html: 'A cream card warming toward the upper left, the dark bottle with a warm-edged shadow, and the Playfair Display title; the warm gain shows in the paper tone.',
    three: 'A warm beige studio under the window rig with a brown-black bottle throwing a long soft shadow left across a warm floor; the warmest of the seven.',
  },
  'neon-tech': {
    html: 'A deep navy card with the bottle sheened pink by the magenta highlight colour and the title in pale blue; the split tone is visible as cyan shadows.',
    three: 'A blue-lit floor with the bottle rimmed magenta on its left edge and cyan on its right; the halation blooms along the floor.',
  },
  'paper-flat': {
    html: 'An off-white card, a slate bottle and the Inter title, flat with no vignette: the plainest of the seven, as the explainer look should be.',
    three: 'A slate bottle on a white cyc under the two crossed lights, both edges lit evenly with a smooth gradient between them; the floor goes white toward the camera.',
  },
  'noir-title': {
    html: 'A black field, a white bottle and the Playfair title; a still carries no grain, so the frame is clean and the vignette only darkens the corners.',
    three: 'A gray bottle on black lit from camera-right by the split rig, its left half in shadow and the cap holding one highlight; the desaturation reads as near-monochrome.',
  },
  'sunset-gradient': {
    html: 'A violet card with a warm cream bottle and a peach title; the orange and violet split tone shows in the corners.',
    three: 'An amber key low from the right over a violet floor; the bottle takes an orange rim on its right edge and the rest sits in violet shadow.',
  },
};

/** The decisions the owner makes from the sheet, each with the default the pipeline takes when nothing is said. */
const questionsForOwner: readonly (readonly [string, string])[] = [
  ['Which look for the first film?', 'obsidian: the fixture is a premium product reveal, and its text clears every check on the dark background.'],
  ['Fonts: keep each look\'s display and body pair?', 'yes; a brand font is not in the bundle, so the four OFL families are the choice until one is added with its license.'],
  ['Colours: the presets\' palettes, or the brand\'s?', 'the presets; a custom look swaps the palette first and re-runs the contrast rule.'],
  ['Film length?', '10 s at 1080p30, the fixture brief; a minute is about 3.5 minutes of html render and longer for three.'],
  ['Music policy?', 'none; a licensed track is dropped in at assembly with the ducking already built.'],
  ['Narration?', 'off (ADR 0007: opt-in); the narration component installs on request and its licenses are disclosed first.'],
];

const evidenceDir = join(repoRoot, 'docs', 'evidence', 'm4');
const never = new AbortController().signal;
const spec: RenderSpec = { fps: 30, width: 960, height: 540 };
const stillFrame = 45;

/** One finished still of the sheet. */
interface LookStill {
  readonly look: NamedLookPreset;
  readonly lane: BrowserLane;
  readonly finished: string;
  readonly render: StillRenderResult;
  readonly environment: string;
  readonly yavg: number | null;
}

/**
 * The fixture shot of a lane, as the lookdev renders it: s03 for html as
 * it is; s01 for three with the look's default rig and the lens focused on
 * the bottle. The fixture focuses at 1.2 m while the solver puts the MCU
 * bottle at 1.68 m at 960x540, and the three lane's bokeh pass would blur
 * the whole bottle at its cap, so the sheet would show no rig or material
 * detail; the fixture's own focus stays a seam for the still command.
 */
function fixtureShot(lane: BrowserLane, look: LookBible): Shot {
  const shot = planShotSpec.shots.find((candidate) => candidate.lane === lane);
  if (shot === undefined) throw new Error(`The plan fixture has no ${lane} shot.`);
  return lane === 'three' ? focusedAtSubject({ ...shot, lighting: lightingOfPreset(look.lightingDefault) }, spec) : shot;
}

/** The average luma of a finished still, measured as the still gate measures it. */
async function stillYavg(runner: ChildProcessRunner, ffmpegPath: string, png: string, statsPath: string): Promise<number | null> {
  await runAnalysis(runner, ffmpegPath, ['-i', png, '-vf', `format=yuv420p,${exposureFilter(statsPath)}`, '-frames:v', '1'], 'ffmpeg signalstats', never);
  return existsSync(statsPath) ? parseSignalstatsYavg(readFileSync(statsPath, 'utf8'))[0] ?? null : null;
}

/** The probe's entry point. */
export async function run(): Promise<void> {
  const runner = new ChildProcessRunner();
  const log = new StreamLogger(LogLevels.normal);
  const browser = await probeBrowser(runner, never);
  const ffmpeg = await probeFfmpeg(runner, never);
  const dataDir = probeDataDir();
  const workRoot = probeWorkDir('lookdev');
  const stillsDir = ensureDirectory(join(workRoot, 'stills'));
  ensureDirectory(evidenceDir);
  log.info(`lookdev probe: ${browser.channel} ${browser.version}, data ${dataDir}, stills under ${stillsDir}`);

  const stills: LookStill[] = [];
  for (const [index, name] of lookPresetNames.entries()) {
    const look = lookPresets[name];
    for (const lane of ['html', 'three'] as const) {
      const shot = fixtureShot(lane, look);
      const environment = lane === 'three' ? resolveEnvironment(shot, dataDir) : null;
      const workDir = join(workRoot, 'work');
      rmSync(workDir, { recursive: true, force: true });
      const raw = join(stillsDir, `${name}-${lane}.raw.png`);
      const finished = join(stillsDir, `${name}-${lane}.png`);
      log.info(`rendering ${name} ${lane} (${lane === 'three' ? shot.lighting.preset : 'title card'})`);
      const render = await renderStill({
        spec: buildShotPageSpec(shot, look, spec, environment), frame: stillFrame, timingFrames: index === 0 ? 4 : 0, outPng: raw,
        dataDir, workDir, browser, policy: 'any', log, signal: never,
      });
      await finishStill(runner, ffmpeg.path, raw, finished, look, never);
      const yavg = await stillYavg(runner, ffmpeg.path, finished, join(workDir, 'yavg.txt'));
      const environmentText = lane === 'html' ? 'none' : environment === null ? 'room environment' : environment.id;
      stills.push({ look: name, lane, finished, render, environment: environmentText, yavg });
    }
  }

  const sheetPath = join(evidenceDir, 'lookdev-sheet.png');
  const sheet = await buildContactSheet(runner, ffmpeg.path, { frames: stills.map((still) => ({ path: still.finished, label: `${still.look} ${still.lane}` })), columns: 2, thumbWidth: 480, output: sheetPath }, never);
  log.info(`wrote ${sheet.outputPath} (${String(sheet.count)} stills, ${String(sheet.columns)}x${String(sheet.rows)})`);

  const timing = stills.filter((still) => still.render.msPerFrame !== null).map((still) => [still.lane, `${formatNumber(still.render.msPerFrame, 1)} ms per frame at ${String(spec.width)}x${String(spec.height)} (${still.look}, ${still.lane === 'three' ? 'four sub-frames, SSAA level 2' : 'style writes and screenshot'})`]);
  const lines: string[] = [
    '# M4 lookdev: the seven looks in both browser lanes',
    '',
    `Generated by \`node scripts/probes/run.ts m4-lookdev\`. \`lookdev-sheet.png\` tiles fourteen stills at ${String(spec.width)}x${String(spec.height)}: for each look of \`references/color/look-bible.md\` (as data in \`src/shared/look/presets.ts\`) the fixture's s03 title card on the html lane and the fixture's s01 product shot at frame ${String(stillFrame)} on the three lane under the look's default rig, with the lens refocused from the fixture's 1.2 m onto the bottle at the solver's distance (\`focusedAtSubject\`; at 1.2 m the bokeh pass blurs the whole bottle at its cap), both graded by the look's LUT and vignette (no grain, as a still is). Left column html, right column three, top to bottom in the table's order.`,
    '',
    markdownTable(['Fact', 'Value'], [...machineFacts(browser, ffmpeg.version), ['Renderer', stills[0]?.render.webglRenderer ?? '']]),
    '',
    '## The looks',
    '',
    markdownTable(['Look', 'Lighting', 'Type (display + body, scale)', 'Tone map', 'Exposure EV', 'QA band', 'html still YAVG', 'three still YAVG', 'three environment'], lookPresetNames.map((name) => {
      const look = lookPresets[name];
      const html = stills.find((still) => still.look === name && still.lane === 'html');
      const three = stills.find((still) => still.look === name && still.lane === 'three');
      return [name, look.lightingDefault, `${look.typography.display} + ${look.typography.body}, ${String(look.typography.scaleRatio)}`, look.toneMapping, String(look.exposureEv), `${String(look.qa.yavgMin)} to ${String(look.qa.yavgMax)}`, formatNumber(html?.yavg ?? null, 1), formatNumber(three?.yavg ?? null, 1), three?.environment ?? ''];
    })),
    '',
    'The YAVG columns measure the whole finished still as the still gate does; a title card is mostly background, so its luma sits near the background\'s, and the band judges picture plates rather than type plates.',
    '',
    `Three-lane stills outside their look's QA band: ${stills.filter((still) => still.lane === 'three' && still.yavg !== null && (still.yavg < lookPresets[still.look].qa.yavgMin || still.yavg > lookPresets[still.look].qa.yavgMax)).map((still) => `${still.look} (${formatNumber(still.yavg, 1)} against ${String(lookPresets[still.look].qa.yavgMin)} to ${String(lookPresets[still.look].qa.yavgMax)})`).join(', ') || 'none'}. The bands are the look bible's numbers; a band a lit product shot cannot reach under its own default rig is a question for the owner below.`,
    '',
    '## What the stills show',
    '',
    markdownTable(['Look', 'html still', 'three still'], lookPresetNames.map((name) => [name, observations[name].html, observations[name].three])),
    '',
    '## Cost per frame',
    '',
    markdownTable(['Lane', 'Measured'], timing),
    '',
    '## Questions for the owner',
    '',
    markdownTable(['Question', 'Default until answered'], questionsForOwner),
    '',
    notVerifiedSection([
      'The sentences above are one reader\'s look at a 480 px thumbnail of each still; nobody has scored them against the vision rubric (M7).',
      'Only studio_small_09 (the product-studio family) is installed here; the other rigs render under the room environment and will look different once their HDRIs are fetched.',
      'The grades are the first numeric reading of the look bible\'s words (`src/shared/look/presets.ts`); none has been compared with a reference picture.',
      'The three-lane stills use the fixture\'s s01 (an 85 mm push-in on the bottle) refocused on the bottle; no look has been rendered on another subject or move, and the fixture\'s own 1.2 m focus (which the still command keeps) has not been shown.',
    ]),
  ];
  const reportPath = join(evidenceDir, 'lookdev.md');
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  log.info(`wrote ${reportPath}`);
}
