/**
 * What the M5 probes (scripts/probes/m5-*.ts) share: the data directory
 * whose tools.json doctor wrote and whose assets folder may hold the
 * studio HDRI, a scratch root under the system temp directory (kept short
 * for MAX_PATH, as the M4 probes do), the fixture's shots on the blender
 * lane, the machine facts a report opens with, the average luma of a PNG
 * and one run of the CLI as a child process. Node only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliResult } from '../../src/cli/result.ts';
import { probeDataDirVariable } from '../../src/calibration/probe-support.ts';
import { focusedAtSubject, lightingOfPreset } from '../../src/calibration/shots.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import type { PlanDocuments } from '../../src/plan/cross-checks.ts';
import { buildJob, jobFolder, jobId, writeJobFolder } from '../../src/plan/job.ts';
import type { JobFolder } from '../../src/plan/job.ts';
import { laneFingerprint, shotKey } from '../../src/plan/shot-key.ts';
import type { RenderFingerprint } from '../../src/plan/shot-key.ts';
import type { ProcessRunner } from '../../src/process/process-runner.ts';
import { runAnalysis } from '../../src/qa/check.ts';
import { exposureFilter } from '../../src/qa/exposure.ts';
import { parseSignalstatsYavg } from '../../src/qa/parse.ts';
import { rgbToLumaConversion } from '../../src/qa/text-contrast.ts';
import { readBlenderTools } from '../../src/render/blender-shot.ts';
import type { BlenderRenderTools } from '../../src/render/blender-shot.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import type { LookBible } from '../../src/shared/contracts/look-bible.ts';
import type { Lane, Shot, ShotSpec } from '../../src/shared/contracts/shot-spec.ts';
import { planBrief, planShotSpec, planTreatment } from '../../tests/plan/fixtures.ts';
import { mutated } from '../../tests/schema/documents/examples.ts';
import { repoRoot } from './lib.ts';

/** The signal the probes run under: nothing cancels them. */
export const never: AbortSignal = new AbortController().signal;

/** The data directory a probe renders from: VF_PROBE_DATA_DIR when set, else a folder under the system temp directory; doctor must have written tools.json there. */
export function m5DataDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = env[probeDataDirVariable];
  return ensureDirectory(named !== undefined && named.length > 0 ? named : join(tmpdir(), 'vision-forge-m5', 'data'));
}

/** A scratch folder for a probe's renders under the system temp directory, created. */
export function m5WorkDir(name: string): string {
  return ensureDirectory(join(tmpdir(), 'vision-forge-m5', name));
}

/** Where the M5 evidence goes. */
export const m5EvidenceDir: string = join(repoRoot, 'docs', 'evidence', 'm5');

/** ffmpeg and Blender from the data directory's tools.json; a missing manifest says to run doctor there. */
export function m5Tools(dataDir: string): BlenderRenderTools {
  if (!existsSync(join(dataDir, 'tools.json'))) {
    throw new Error(`${dataDir} has no tools.json; run node scripts/cli.ts doctor --data-dir ${dataDir} first (and assets --fetch hdri:studio_small_09-1k for the studio HDRI).`);
  }
  return readBlenderTools(dataDir);
}

/** The fixture shot of the id on the blender lane, as the plan fixture has it otherwise. */
export function blenderFixtureShot(id: string): Shot {
  const shot = planShotSpec.shots.find((candidate) => candidate.id === id);
  if (shot === undefined) throw new Error(`The plan fixture has no shot "${id}".`);
  return mutated(shot, (copy) => { copy.lane = 'blender'; });
}

/** The fixture's s01 on the blender lane under the look's default rig, focused on the bottle, as the M4 lookdev renders it on the three lane. */
export function lookdevBlenderShot(look: LookBible, spec: RenderSpec): Shot {
  return focusedAtSubject({ ...blenderFixtureShot('s01'), lighting: lightingOfPreset(look.lightingDefault) }, spec);
}

/** The machine facts a report opens with: platform, Node, Blender, ffmpeg, the GPU devices doctor's probe listed and the date. */
export function m5MachineFacts(tools: BlenderRenderTools): readonly (readonly [string, string])[] {
  const devices = (tools.blender.devices ?? []).map((device) => `${device.name} (${device.type})`).join(', ');
  return [
    ['Platform', `${process.platform} ${process.arch}`],
    ['Node', process.version],
    ['Blender', `${tools.blender.version} at ${tools.blender.path}`],
    ['Blender Python', tools.blender.python ?? 'not probed'],
    ['Cycles devices', devices.length > 0 ? devices : 'not probed'],
    ['Interactive session', tools.interactiveSession ? 'yes' : 'no'],
    ['ffmpeg', tools.ffmpeg.version],
    ['Generated', new Date().toISOString()],
  ];
}

/** The average luma of a PNG as the still gate measures it (BT.709, limited range); null when signalstats printed none. */
export async function pngYavg(runner: ProcessRunner, ffmpegPath: string, png: string, statsPath: string): Promise<number | null> {
  await runAnalysis(runner, ffmpegPath, ['-i', png, '-vf', `${rgbToLumaConversion},${exposureFilter(statsPath)}`, '-frames:v', '1'], 'ffmpeg signalstats', never);
  return existsSync(statsPath) ? parseSignalstatsYavg(readFileSync(statsPath, 'utf8'))[0] ?? null : null;
}

/** Writes a job folder under outDir the way plan does (the fixture's brief and treatment, the given shot spec and look, a key per shot) without plan's cross-document checks, and returns it. */
export async function writeProbeJob(outDir: string, shotSpec: ShotSpec, look: LookBible, dataDir: string): Promise<JobFolder> {
  const documents: PlanDocuments = { brief: planBrief, treatment: planTreatment, shotSpec, look };
  const id = await jobId(documents.brief, documents.treatment, shotSpec, look);
  const folder = jobFolder(outDir, id);
  const fingerprints = new Map<Lane, RenderFingerprint>();
  const keys: string[] = [];
  for (const shot of shotSpec.shots) {
    const fingerprint = fingerprints.get(shot.lane) ?? await laneFingerprint(dataDir, shot.lane);
    fingerprints.set(shot.lane, fingerprint);
    keys.push(await shotKey(shot, look, fingerprint));
  }
  writeJobFolder(folder, documents, buildJob({ id, documents, keys, folder, dataDir, createdAt: new Date().toISOString(), previous: undefined }));
  return folder;
}

/** What one CLI run produced: the result document it printed (or null when it printed none), its exit code and how long it took. */
export interface CliRun {
  readonly args: readonly string[];
  readonly result: CliResult | null;
  readonly exitCode: number | null;
  readonly elapsedMs: number;
  readonly stderr: string;
}

/** Runs `node scripts/cli.ts <args>` as a child process (the running Node, by its absolute path) with the data directory, and parses the one JSON document it prints. */
export async function runCli(runner: ProcessRunner, dataDir: string, args: readonly string[], timeoutMs: number): Promise<CliRun> {
  const full = [join(repoRoot, 'scripts', 'cli.ts'), ...args, '--data-dir', dataDir];
  const run = await runner.run({ label: 'node', executable: process.execPath, args: full, cwd: repoRoot, timeoutMs }, never);
  let result: CliResult | null = null;
  try {
    result = JSON.parse(run.stdout) as CliResult;
  } catch {
    result = null;
  }
  return { args: ['node', 'scripts/cli.ts', ...args, '--data-dir', dataDir], result, exitCode: run.exitCode, elapsedMs: run.elapsedMs, stderr: run.stderr };
}
