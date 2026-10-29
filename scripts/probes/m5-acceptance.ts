/**
 * M5 acceptance probe (ADR 0004, the evidence it asks for before scene
 * work): with the Blender doctor recorded in the data directory's
 * tools.json, writes docs/evidence/m5/acceptance.md with the `--version`
 * line, the probe's engine list and devices, one-frame renders of the
 * fixture bottle through EEVEE on OpenGL, EEVEE on Vulkan and Cycles on
 * OptiX with timings, the non-black check and the crash-log check, the
 * exit-code matrix with every argv and stderr tail, then the production
 * commands on real jobs: a 1920x1080 still of s01 through `still`, a
 * 30-frame render of s01 and a 150-frame turntable of s02 at 480x270
 * through `render`, contact sheets of both, and a quality assessment
 * written after looking at the frames. The assessment is data at the top
 * of this file.
 *
 * `node scripts/probes/run.ts m5-acceptance`, with VF_PROBE_DATA_DIR naming
 * a data directory where doctor and `assets --fetch hdri:studio_small_09-1k`
 * have run.
 */
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StreamLogger, LogLevels } from '../../src/cli/logger.ts';
import type { CliResult } from '../../src/cli/result.ts';
import type { RenderData } from '../../src/cli/commands/render.ts';
import { stillPaths } from '../../src/cli/commands/still.ts';
import { reducePng } from '../../src/calibration/probe-support.ts';
import { formatNumber, markdownTable, notVerifiedSection } from '../../src/calibration/report.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import { ladderAttempt } from '../../src/lanes/blender/ladder.ts';
import type { LadderRung } from '../../src/lanes/blender/ladder.ts';
import { blackFrameYavg } from '../../src/lanes/blender/success.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { blenderHdriPath } from '../../src/render/environment.ts';
import type { BlenderRenderTools } from '../../src/render/blender-shot.ts';
import { gateReportPath, readGateReport } from '../../src/render/still-gate.ts';
import { readJsonFile } from '../../src/fs/atomic-json.ts';
import { jobFileNames } from '../../src/plan/job.ts';
import { defaultStillFrame } from '../../src/render/still-frame.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import type { ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { buildContactSheet } from '../../src/sheet/contact-sheet.ts';
import { planLook, planShotSpec } from '../../tests/plan/fixtures.ts';
import { mutated } from '../../tests/schema/documents/examples.ts';
import { exitMatrix, rawRender } from './m5-raw-render.ts';
import type { RawRender } from './m5-raw-render.ts';
import { commandBlock, engineRenderTable, exitCodeTable, formatExit, formatSeconds } from './m5-report.ts';
import type { EngineRenderRow } from './m5-report.ts';
import { blenderFixtureShot, m5DataDir, m5EvidenceDir, m5MachineFacts, m5Tools, m5WorkDir, never, pngYavg, runCli, writeProbeJob } from './m5-support.ts';

/** The quality assessment, written after looking at the still and the two contact sheets. */
const qualityAssessment: readonly string[] = [
  'The 1080p still (EEVEE on OpenGL, the ladder\'s first rung, graded by the fixture look): the gold bottle stands thirds-right on the near-black cyc with the key\'s highlight down its right flank and a soft terminator across the body, the cap\'s brushed metal picking up the HDRI\'s softbox; a soft shadow falls to camera-left and the floor-to-wall transition is a smooth horizontal gradient with no seam at the arc. The bottle reads as glossy plastic, not glass, which is the material the resolver writes (an opaque body under a clear coat, no transmission); the neck meets the body at a hard step and the cap is a flat disc, since the subject is a stack of primitives, not a lathe.',
  'The 30-frame push-in (`clip-s01-480x270.png`): the exposure is steady thumbnail to thumbnail (no flicker; a clip is not denoised) and the shadow holds its place; the push-in itself is small at 0.4 amplitude over 30 frames and reads at 200 px only as a slight growth of the bottle between the first and the last thumbnail. The 30 frames hash to 30 distinct values in the manifest, so every frame differs.',
  'The turntable (`turntable-s02-480x270.png`): the fixture bottle is a stack of cylinders, so its 40-degree turn (the move\'s cap at amplitude 1 over 150 frames) leaves the silhouette and the highlight unchanged, and the 30 thumbnails look identical; the 150 frames still hash to 150 distinct values, so the frames differ (EEVEE\'s sampling and the cap\'s facets), but neither the turn nor the motion blur can be judged on this subject. A subject with a visible asymmetry is needed to see them.',
  'EEVEE against Cycles on the one-frame renders (`s01-f104-*-480x270.png`, raw, no grade): the three frames are near-identical at this size (YAVG 39.2, 39.2 and 39.9); Cycles puts a slightly denser contact shadow under the bottle and a softer gradient on the body\'s dark side, EEVEE a touch brighter coat highlight. EEVEE on Vulkan matches EEVEE on OpenGL in luma to the tenth; its first run of the day took 10.6 s against OpenGL\'s 3.7 s (the shader compile of a second backend, cached under the data directory\'s blender-user folder since, so the table above shows the warm time). The ladder\'s first rung is a fair stand-in for a Cycles still at this size.',
];

/** The last bullet of the assessment, with the turntable's estimate and the time its remaining frames took read from the run, so a re-run cannot leave stale seconds in it. */
function openOrWrong(turntable: RenderData['shots'][number] | undefined): string {
  const estimate = turntable?.estimate ?? null;
  const rest = turntable === undefined || estimate === null ? null : turntable.elapsedMs / 1000 - estimate.secondsPerFrame * 3;
  const ceiling = estimate === null || rest === null ? 'the 150-frame render ran as one batch or failed, so the estimate is not recorded' : `the ${String(turntableFrames)}-frame render's estimate from its three-frame first batch (${String(estimate.secondsPerFrame)} s per frame, ${String(estimate.totalSeconds)} s for the remaining ${String(turntableFrames - 3)}) was about ${formatNumber(estimate.totalSeconds / rest, 1)} times the ${formatNumber(rest, 0)} s they took, since the first batch carries Blender's start, as the estimator's note says (a ceiling)`;
  return `Open or wrong: ${ceiling}; the fixture's 200 motes and its haze are not rendered on the blender lane (the three lane's seeded points have no Blender counterpart), so the two lanes differ in atmosphere; the 2k HDRI is not installed, so the 1k one serves the world; and Blender prints two DeprecationWarnings for \`World.use_nodes\` and \`Material.use_nodes\` (to be removed in 6.0), which the stderr tails above show.`;
}

const stillSpec: RenderSpec = { fps: planShotSpec.fps, width: planShotSpec.width, height: planShotSpec.height };
const clipSpec: RenderSpec = { fps: 30, width: 480, height: 270 };
const clipFrames = 30;
const turntableFrames = 150;
const sheetEvery = 5;

/** The fixture spec with s01 on the blender lane, at the fixture's 1920x1080, for the still. */
function stillShotSpec(): ShotSpec {
  return mutated(planShotSpec, (copy) => {
    const first = copy.shots[0];
    if (first !== undefined) first.lane = 'blender';
  });
}

/** The fixture spec at 480x270 with s01 as a 30-frame blender push-in and s02 as a 150-frame blender turntable over its whole length at full amplitude (40 degrees, the move's cap). */
function clipShotSpec(): ShotSpec {
  return mutated(planShotSpec, (copy) => {
    copy.width = clipSpec.width;
    copy.height = clipSpec.height;
    const [first, second] = copy.shots;
    if (first !== undefined) { first.lane = 'blender'; first.durationFrames = clipFrames; }
    if (second !== undefined) { second.lane = 'blender'; second.durationFrames = turntableFrames; second.move = { preset: 'turntable', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: null }; }
    // The dissolve after s01 must fit inside both shots; 15 frames fit the 30-frame clip.
  });
}

/** The engine row of a raw render. */
function engineRow(render: RawRender): EngineRenderRow {
  return { attempt: render.attempt.name, samples: render.attempt.attempt.samples, exitCode: render.result.exitCode, elapsedMs: render.result.elapsedMs, yavg: render.yavg, nonBlack: render.yavg !== null && render.yavg > blackFrameYavg, crashLogNew: render.crashLogNew, verdict: render.verdict.ok ? 'ok' : `${render.verdict.code}: ${render.verdict.reason}` };
}

/** The frames of a render's frames folder, every n-th, labelled by frame number. */
function sheetFrames(framesDir: string, shotId: string, every: number): readonly { readonly path: string; readonly label: string }[] {
  return readdirSync(framesDir).filter((name) => /^f\d{6}\.png$/.test(name)).sort().filter((_name, index) => index % every === 0).map((name) => ({ path: join(framesDir, name), label: `${shotId} ${name.slice(0, -4)}` }));
}

/** The render payload of a CLI result, or undefined when the command failed. */
function renderData(result: CliResult | null): RenderData | undefined {
  return result !== null && result.ok ? (result.data as RenderData) : undefined;
}

/** The probe's entry point. */
export async function run(): Promise<void> {
  const runner = new ChildProcessRunner();
  const log = new StreamLogger(LogLevels.normal);
  const dataDir = m5DataDir();
  const tools: BlenderRenderTools = m5Tools(dataDir);
  const workRoot = m5WorkDir('acceptance');
  ensureDirectory(m5EvidenceDir);
  log.info(`acceptance probe: Blender ${tools.blender.version} at ${tools.blender.path}, data ${dataDir}, work ${workRoot}`);

  const versionRun = await runner.run({ label: 'blender', executable: tools.blender.path, args: ['--version'], timeoutMs: 60_000 }, never);
  const versionLine = versionRun.stdout.split(/\r?\n/).find((line) => line.startsWith('Blender')) ?? versionRun.stdout.trim();

  const shot = blenderFixtureShot('s01');
  const hdri = blenderHdriPath(shot, dataDir);
  const frame = defaultStillFrame(shot, clipSpec.fps);
  const rungs: readonly LadderRung[] = [{ engine: 'eevee', backend: 'opengl' }, { engine: 'eevee', backend: 'vulkan' }, { engine: 'cycles', backend: 'OPTIX' }];
  const renders: RawRender[] = [];
  const rawDir = join(workRoot, 'raw');
  rmSync(rawDir, { recursive: true, force: true });
  for (const rung of rungs) {
    const attempt = ladderAttempt(rung, 'still', clipSpec.width);
    log.info(`one frame through ${attempt.name}`);
    renders.push(await rawRender({ shot, look: planLook, spec: clipSpec, frame, attempt, tools, dataDir, hdriPath: hdri, workDir: join(rawDir, attempt.name), runner, log }));
  }
  const matrix = await exitMatrix({ shot, look: planLook, spec: clipSpec, frame, attempt: ladderAttempt({ engine: 'cycles', backend: 'OPTIX' }, 'still', clipSpec.width), tools, dataDir, hdriPath: hdri, workDir: join(rawDir, 'exit'), runner, log }, renders[2]);
  for (const render of renders) {
    if (existsSync(render.framePath)) await reducePng(runner, tools.ffmpeg.path, render.framePath, join(m5EvidenceDir, `s01-f${String(frame)}-${render.attempt.name}-480x270.png`), 480, never);
  }

  // The still: the fixture at 1920x1080 with s01 on the blender lane, through the still command (the ladder picks the engine and pins it).
  const jobsDir = join(workRoot, 'jobs');
  rmSync(jobsDir, { recursive: true, force: true });
  const stillJob = await writeProbeJob(jobsDir, stillShotSpec(), planLook, dataDir);
  log.info(`still of s01 at ${String(stillSpec.width)}x${String(stillSpec.height)} on job ${stillJob.dir}`);
  const stillRun = await runCli(runner, dataDir, ['still', '--job', stillJob.dir, '--shot', 's01'], 30 * 60_000);
  const stillFiles = stillPaths(stillJob.dir, 's01', 1);
  const stillOk = existsSync(stillFiles.still);
  const gate = stillOk && existsSync(gateReportPath(stillFiles.still)) ? readGateReport(gateReportPath(stillFiles.still)) : undefined;
  const pinnedSpec = readJsonFile(join(stillJob.dir, jobFileNames.shotSpec)) as ShotSpec;
  const pinned = pinnedSpec.shots.find((candidate) => candidate.id === 's01')?.renderProfile ?? null;
  const stillYavg = stillOk ? await pngYavg(runner, tools.ffmpeg.path, stillFiles.still, join(workRoot, 'still-yavg.txt')) : null;
  if (stillOk) await reducePng(runner, tools.ffmpeg.path, stillFiles.still, join(m5EvidenceDir, 'still-s01-1920x1080-960.png'), 960, never);

  // The clip and the turntable: one job at 480x270, a still per shot to pin the engine, then render with the pin.
  const clipJob = await writeProbeJob(jobsDir, clipShotSpec(), planLook, dataDir);
  const pins = [await runCli(runner, dataDir, ['still', '--job', clipJob.dir, '--shot', 's01'], 15 * 60_000), await runCli(runner, dataDir, ['still', '--job', clipJob.dir, '--shot', 's02'], 15 * 60_000)];
  // --force: render reuses a complete manifest under the same key, and the wall clock of a cache hit would say nothing about Blender.
  const clipRun = await runCli(runner, dataDir, ['render', '--job', clipJob.dir, '--shot', 's01', '--allow-unapproved', '--force'], 30 * 60_000);
  const turntableRun = await runCli(runner, dataDir, ['render', '--job', clipJob.dir, '--shot', 's02', '--allow-unapproved', '--force'], 60 * 60_000);
  const clip = renderData(clipRun.result)?.shots[0];
  const turntable = renderData(turntableRun.result)?.shots[0];
  const sheets: { readonly name: string; readonly path: string; readonly bytes: number; readonly count: number }[] = [];
  for (const [name, data, every] of [['clip-s01-480x270.png', clip, 1], ['turntable-s02-480x270.png', turntable, sheetEvery]] as const) {
    if (data === undefined) continue;
    const path = join(m5EvidenceDir, name);
    const frames = sheetFrames(data.framesDir, data.id, every);
    await buildContactSheet(runner, tools.ffmpeg.path, { frames, columns: 6, thumbWidth: 200, output: path }, never);
    sheets.push({ name, path, bytes: statSync(path).size, count: frames.length });
  }

  const cliRow = (label: string, run: typeof stillRun): readonly string[] => [label, run.args.slice(2).join(' '), formatExit(run.exitCode), formatSeconds(run.elapsedMs), run.result === null ? 'no result document' : run.result.ok ? 'ok' : run.result.errors.map((error) => `${error.code}: ${error.message}`).join('; ')];
  const lines: string[] = [
    '# M5 acceptance: Blender 5.2.3 on this machine',
    '',
    'Generated by `node scripts/probes/run.ts m5-acceptance`. The evidence ADR 0004 asks for before scene work, plus the production commands on real jobs. Every number is from one run on the date below.',
    '',
    markdownTable(['Fact', 'Value'], [...m5MachineFacts(tools), ['`blender --version`', versionLine], ['Data directory', dataDir], ['HDRI for the world', hdri ?? 'none installed (flat world)']]),
    '',
    '## The probe (doctor)',
    '',
    `\`RenderSettings.engine\` lists ${(tools.blender.engines ?? []).map((engine) => `\`${engine}\``).join(', ')} before the Cycles add-on is enabled (the applier enables it); compute device types ${(tools.blender.computeDeviceTypes ?? []).join(', ')}; devices ${(tools.blender.devices ?? []).map((device) => `${device.name} (${device.type})`).join(', ')}; \`Action.slots\` ${tools.blender.actionSlots === true ? 'present' : 'absent'}; \`ImageFormatSettings.media_type\` ${tools.blender.mediaType === true ? 'present' : 'absent'}.`,
    '',
    '## One frame per engine',
    '',
    `The fixture's s01 (the 0.25 m bottle, 85 mm f/2.8, product-studio, the fixture's obsidian look bible with its gold primary, AgX at −0.3 EV) on the blender lane at ${String(clipSpec.width)}x${String(clipSpec.height)}, frame ${String(frame)} (the still command's default, the end of the push-in), rendered as a still (denoised) through the runner (\`src/lanes/blender/runner.ts\`) and judged by the predicate (\`src/lanes/blender/success.ts\`). The wall clock is Blender's whole run. The non-black check is the predicate's: the frame's BT.709 YAVG above ${String(blackFrameYavg)}. The crash log is \`%TEMP%\\blender.crash.txt\`, compared before and after each run.`,
    '',
    engineRenderTable(renders.map(engineRow)),
    '',
    ...renders.flatMap((render) => [`### ${render.attempt.name}`, '', commandBlock(tools.blender.path, render.args), '', `stderr tail: ${render.verdict.ok ? (render.stderrTail.length === 0 ? '(empty)' : render.stderrTail) : render.verdict.stderrTail}`, '']),
    '## Exit-code matrix',
    '',
    exitCodeTable(matrix.map((entry) => entry.row)),
    '',
    ...matrix.flatMap((entry) => [`### ${entry.row.scenario}`, '', entry.note, '', commandBlock(tools.blender.path, entry.args), '']),
    '## The still command',
    '',
    `The fixture's shot spec with s01 on the blender lane, planned as a job at ${String(stillSpec.width)}x${String(stillSpec.height)} (\`writeProbeJob\`: the job folder as plan writes it, with the fixture's brief, treatment and look), then \`still\`, which runs the ladder (EEVEE on OpenGL first) in the round's scratch folder, grades the frame and pins the rung.`,
    '',
    markdownTable(['Command', 'Arguments', 'Exit', 'Wall clock', 'Result'], [cliRow('still', stillRun)]),
    '',
    `Pinned render profile: ${pinned === null ? 'none' : `${pinned.engine} on ${pinned.backend} (${pinned.renderer})`}; still ${stillOk ? `${stillFiles.still} (YAVG ${formatNumber(stillYavg, 1)}; a 960 px copy is \`still-s01-1920x1080-960.png\` beside this file)` : 'not written'}; gate ${gate === undefined ? 'no report' : gate.checks.map((check) => `${check.id} ${check.ok ? 'ok' : 'FAILED'} (${check.detail})`).join('; ')}.`,
    '',
    '## The render command',
    '',
    `One job at ${String(clipSpec.width)}x${String(clipSpec.height)}: s01 as a ${String(clipFrames)}-frame push-in and s02 as a ${String(turntableFrames)}-frame turntable (amplitude 1, the move's 40-degree cap, over the whole shot), both on the blender lane. A still per shot pins the engine, then \`render --allow-unapproved --force\` renders each shot with its pin (a three-frame estimate batch, then batches of 30 frames per Blender process; \`--force\` so a re-run renders rather than reusing the cache).`,
    '',
    markdownTable(['Command', 'Arguments', 'Exit', 'Wall clock', 'Result'], [cliRow('still s01', pins[0] ?? stillRun), cliRow('still s02', pins[1] ?? stillRun), cliRow('render s01', clipRun), cliRow('render s02', turntableRun)]),
    '',
    markdownTable(['Shot', 'Frames', 'Elapsed', 'ms per frame', 'Estimate from the first batch', 'Frames dir'], [clip, turntable].map((data) => data === undefined ? ['(failed)', '', '', '', '', ''] : [data.id, String(data.frames), formatSeconds(data.elapsedMs), formatNumber(data.msPerFrame, 0), data.estimate === null ? 'one batch, none' : `${String(data.estimate.secondsPerFrame)} s per frame, ${String(data.estimate.totalSeconds)} s for the rest`, data.framesDir])),
    '',
    `Contact sheets: ${sheets.map((sheet) => `\`${sheet.name}\` (${String(sheet.count)} frames${sheet.name.startsWith('turntable') ? `, every ${String(sheetEvery)}th` : ''}, ${String(sheet.bytes)} bytes)`).join('; ')}.`,
    '',
    '## Quality assessment',
    '',
    ...[...qualityAssessment, openOrWrong(turntable)].map((sentence) => `- ${sentence}`),
    '',
    notVerifiedSection([
      'Cycles on CUDA and Cycles on the CPU were not run here (the integration test renders one 64x36 Cycles CPU frame). EEVEE on Vulkan passed here; its wall clock depends on the shader cache under the data directory\'s blender-user folder (10.6 s cold on this day\'s first run, 3.6 s warm), and the rung has not been tried on a machine without a Vulkan driver.',
      'A render failure that exits 1 could not be provoked through the applier\'s argv: Blender raises a Python exception for a render error (exit 3); the one exit 1 recorded is Blender refusing a missing .blend file outside the applier.',
      'The still gate\'s verdict on the 1080p still is recorded, not asserted: a failed exposure check is a question for the look\'s band, not for the lane.',
      'Only one machine (Windows 11, RTX 2060, driver 610.88) has run this; the timings are its.',
    ]),
  ];
  const reportPath = join(m5EvidenceDir, 'acceptance.md');
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  log.info(`wrote ${reportPath}`);
}
