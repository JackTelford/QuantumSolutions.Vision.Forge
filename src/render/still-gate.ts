/**
 * The still gate: the three measured checks a finished still must pass
 * before anyone looks at it (ADR 0004 decision 6, ADR 0006 decision 7).
 * Composition runs the solver's geometric checks on the shot's base
 * framing; text contrast measures the luma behind every text box on the
 * finished still and turns it into a WCAG ratio against the look's text
 * colour, exactly as the QA text-contrast check does on a delivery;
 * exposure holds the still's average luma inside the look's band. The
 * report is written as JSON beside the still so a failed gate leaves its
 * numbers behind.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataFileError } from '../errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../fs/atomic-json.ts';
import { ensureDirectory } from '../fs/paths.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { round, runAnalysis } from '../qa/check.ts';
import { exposureFilter } from '../qa/exposure.ts';
import { contrastRatio, relativeLuminanceOfHex, relativeLuminanceOfLuma } from '../qa/luminance.ts';
import { parseSignalstatsYavg } from '../qa/parse.ts';
import { boxLumaFilter, contrastThreshold, pixelBox } from '../qa/text-contrast.ts';
import type { RenderSpec } from '../shared/camera/types.ts';
import { compositionProblems } from '../shared/composition/checks.ts';
import { baseFrame } from '../shared/composition/framing.ts';
import { solveBasePose } from '../shared/composition/solver.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { Shot } from '../shared/contracts/shot-spec.ts';
import type { TextOverflow } from '../shared/harness/protocol.ts';

/** The ids of the gate's checks, in the order they run. */
export type StillGateCheckId = 'composition' | 'text-contrast' | 'exposure';

/** One check of the gate. */
export interface StillGateCheck {
  readonly id: StillGateCheckId;
  readonly ok: boolean;
  /** The measured value: problem count, lowest contrast ratio or YAVG; null when nothing was measured. */
  readonly measured: number | null;
  /** The limit the value was held to; null when the check has a band or nothing to measure. */
  readonly threshold: number | null;
  readonly detail: string;
}

/** What the gate reports. */
export interface StillGateReport {
  readonly passed: boolean;
  readonly checks: readonly StillGateCheck[];
}

/** What the gate needs. */
export interface StillGateInputs {
  readonly runner: ProcessRunner;
  readonly ffmpegPath: string;
  readonly shot: Shot;
  readonly look: LookBible;
  readonly spec: RenderSpec;
  /** The graded still, already finished. */
  readonly finishedPng: string;
  /** Scratch folder for the signalstats side files; the caller removes it. */
  readonly workDir: string;
  readonly signal: AbortSignal;
  /** The browser's own measurement of each text box, from the page's init report; absent when no browser session was opened. */
  readonly textOverflows?: readonly TextOverflow[];
}

/** The gate report's path for a still: the still's path with `.gate.json` in place of `.png`. */
export function gateReportPath(finishedPng: string): string {
  return finishedPng.replace(/\.png$/i, '') + '.gate.json';
}

/** The sentences for text the browser laid out past its box: one per element with any overflow, in pixels. */
export function overflowProblems(overflows: readonly TextOverflow[] | undefined): readonly string[] {
  return (overflows ?? []).filter((entry) => entry.overflowXPx > 0 || entry.overflowYPx > 0)
    .map((entry) => `Text ${entry.id} spills past its box by ${Math.ceil(entry.overflowXPx)} px to the right and ${Math.ceil(entry.overflowYPx)} px below, as the browser laid it out.`);
}

/** Check (a): the solver's geometric checks on the base framing (with the look's type scale for the text fit) plus the browser's text measurement; measured is the problem count. */
export function compositionCheck(shot: Shot, spec: RenderSpec, typography?: LookBible['typography'], overflows?: readonly TextOverflow[]): StillGateCheck {
  const problems = [...compositionProblems(shot, spec, baseFrame(shot, solveBasePose(shot, spec)), typography), ...overflowProblems(overflows)];
  return {
    id: 'composition',
    ok: problems.length === 0,
    measured: problems.length,
    threshold: 0,
    detail: problems.length === 0 ? 'the base framing passes composition checks 1 to 5' : problems.join(' '),
  };
}

/** The average luma of a still (or of a box of it) through signalstats, read from the metadata filter's print file; undefined when ffmpeg printed none. */
async function measureYavg(inputs: StillGateInputs, filter: string, statsPath: string): Promise<number | undefined> {
  await runAnalysis(inputs.runner, inputs.ffmpegPath, ['-i', inputs.finishedPng, '-vf', filter, '-frames:v', '1'], 'ffmpeg signalstats', inputs.signal);
  if (!existsSync(statsPath)) return undefined;
  return parseSignalstatsYavg(readFileSync(statsPath, 'utf8'))[0];
}

/** Check (b): the WCAG ratio of the look's text colour against the luma behind each text box; the lowest must reach 4.5. */
export async function textContrastCheck(inputs: StillGateInputs): Promise<StillGateCheck> {
  const { shot, look, spec } = inputs;
  if (shot.text.length === 0) return { id: 'text-contrast', ok: true, measured: null, threshold: contrastThreshold, detail: 'no text' };
  const textLuminance = relativeLuminanceOfHex(look.palette.text);
  const details: string[] = [];
  let lowest = Number.POSITIVE_INFINITY;
  let unmeasured = 0;
  for (const element of shot.text) {
    const statsPath = join(inputs.workDir, `gate-text-${element.id}.txt`);
    const yavg = await measureYavg(inputs, boxLumaFilter(pixelBox(element.box, spec.width, spec.height), statsPath), statsPath);
    if (yavg === undefined) {
      unmeasured += 1;
      details.push(`${element.id} (${element.role}): signalstats printed no luma for its box`);
      continue;
    }
    const ratio = contrastRatio(textLuminance, relativeLuminanceOfLuma(yavg));
    lowest = Math.min(lowest, ratio);
    details.push(`${element.id} (${element.role}): ${round(ratio, 2)}:1 against text ${look.palette.text} over box luma ${round(yavg, 1)}`);
  }
  const measured = Number.isFinite(lowest) ? round(lowest, 2) : null;
  return { id: 'text-contrast', ok: unmeasured === 0 && measured !== null && measured >= contrastThreshold, measured, threshold: contrastThreshold, detail: details.join('; ') };
}

/** Check (c): the still's average luma inside the look's QA band. */
export async function exposureCheck(inputs: StillGateInputs): Promise<StillGateCheck> {
  const statsPath = join(inputs.workDir, 'gate-exposure.txt');
  // The still is RGB; the explicit format step puts the conversion to YUV where the box filter has it, so both checks read the same luma.
  const yavg = await measureYavg(inputs, `format=yuv420p,${exposureFilter(statsPath)}`, statsPath);
  const { yavgMin, yavgMax } = inputs.look.qa;
  if (yavg === undefined) return { id: 'exposure', ok: false, measured: null, threshold: null, detail: 'signalstats printed no luma for the still' };
  const ok = yavg >= yavgMin && yavg <= yavgMax;
  return { id: 'exposure', ok, measured: round(yavg, 1), threshold: null, detail: `average luma ${round(yavg, 1)} YAVG ${ok ? 'inside' : 'outside'} the look's band ${yavgMin} to ${yavgMax}` };
}

/** Runs the three checks, writes the report beside the still and returns it. */
export async function runStillGate(inputs: StillGateInputs): Promise<StillGateReport> {
  ensureDirectory(inputs.workDir);
  const checks: StillGateCheck[] = [compositionCheck(inputs.shot, inputs.spec, inputs.look.typography, inputs.textOverflows), await textContrastCheck(inputs), await exposureCheck(inputs)];
  const report: StillGateReport = { passed: checks.every((check) => check.ok), checks };
  writeJsonAtomic(gateReportPath(inputs.finishedPng), report);
  return report;
}

/** Reads a gate report written by runStillGate; a missing or malformed file is a DataFileError. */
export function readGateReport(path: string): StillGateReport {
  const parsed = readJsonFile(path) as Partial<StillGateReport> | null;
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.passed !== 'boolean' || !Array.isArray(parsed.checks)) {
    throw new DataFileError(path, 'it is not a still gate report', 'Run still again; it writes the report beside the still.');
  }
  return { passed: parsed.passed, checks: parsed.checks };
}

/** One line per failing check, for the gate error's message. */
export function describeFailures(report: StillGateReport): string {
  return report.checks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.detail}`).join(' | ');
}
