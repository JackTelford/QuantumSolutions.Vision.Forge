/**
 * The Markdown the M5 probes write, as pure text functions of what they
 * measured, built on src/calibration/report.ts so the tables look like the
 * M4 ones and a test can hold the formatting still: the engine table of
 * the one-frame renders, the exit-code matrix, a command block, the
 * lookdev table with the Blender column. No file system, no clock.
 */
import { formatNumber, markdownTable } from '../../src/calibration/report.ts';

/** One attempt's one-frame render, as the acceptance probe measured it. */
export interface EngineRenderRow {
  /** "eevee-opengl", "cycles-OPTIX". */
  readonly attempt: string;
  readonly samples: number;
  readonly exitCode: number | null;
  /** Blender's whole run: start, shader compile, the frame, teardown. */
  readonly elapsedMs: number;
  /** The frame's average luma through the gate's conversion; null when the file was missing or unreadable. */
  readonly yavg: number | null;
  readonly nonBlack: boolean;
  readonly crashLogNew: boolean;
  /** "ok" or the predicate's failure code and reason. */
  readonly verdict: string;
}

/** One row of the exit-code matrix. */
export interface ExitCodeRow {
  readonly scenario: string;
  readonly exitCode: number | null;
  /** The code the runner's predicate gave the run: "ok", "blender-script", "blender-render", "blender-timeout", or "not judged" for a run outside the applier's argv. */
  readonly verdictCode: string;
  /** The last characters of standard error, on one line. */
  readonly stderrTail: string;
}

/** One finished still of the lookdev sheet. */
export interface LookdevRow {
  readonly look: string;
  readonly toneMapping: string;
  readonly yavgMin: number;
  readonly yavgMax: number;
  readonly htmlYavg: number | null;
  readonly threeYavg: number | null;
  readonly blenderYavg: number | null;
  /** The blender still's render time in milliseconds, Blender's start included. */
  readonly blenderMs: number;
}

/** "0", "3221225477" or "none (killed)". */
export function formatExit(exitCode: number | null): string {
  return exitCode === null ? 'none (killed)' : String(exitCode);
}

/** Milliseconds as seconds with one decimal and the unit. */
export function formatSeconds(elapsedMs: number): string {
  return `${formatNumber(elapsedMs / 1000, 1)} s`;
}

/** The engine table: attempt, samples, exit, wall clock, the frame's luma, whether it is non-black, the crash log, the verdict. */
export function engineRenderTable(rows: readonly EngineRenderRow[]): string {
  return markdownTable(
    ['Attempt', 'Samples', 'Exit', 'Wall clock', 'Frame YAVG', 'Non-black', 'New crash log', 'Verdict'],
    rows.map((row) => [row.attempt, String(row.samples), formatExit(row.exitCode), formatSeconds(row.elapsedMs), formatNumber(row.yavg, 1), row.nonBlack ? 'yes' : 'no', row.crashLogNew ? 'yes' : 'no', row.verdict]),
  );
}

/** The exit-code matrix: scenario, exit code, the predicate's code, the stderr tail. */
export function exitCodeTable(rows: readonly ExitCodeRow[]): string {
  return markdownTable(
    ['Scenario', 'Exit', 'Predicate', 'stderr tail'],
    rows.map((row) => [row.scenario, formatExit(row.exitCode), row.verdictCode, row.stderrTail.length === 0 ? '(empty)' : row.stderrTail]),
  );
}

/** A fenced block with the exact command line, the executable first and every argument on its own line so a long argv stays readable. */
export function commandBlock(executable: string, args: readonly string[]): string {
  return ['```text', executable, ...args.map((argument) => `  ${argument}`), '```'].join('\n');
}

/** True when a luma sits inside a look's QA band; false for an unmeasured one. */
export function inBand(yavg: number | null, min: number, max: number): boolean {
  return yavg !== null && yavg >= min && yavg <= max;
}

/** The lookdev table: look, tone map, band, the three lanes' still YAVG (the blender one marked when outside the band), the blender render time. */
export function lookdevTable(rows: readonly LookdevRow[]): string {
  return markdownTable(
    ['Look', 'Tone map', 'QA band', 'html still YAVG', 'three still YAVG', 'blender still YAVG', 'In band', 'blender render'],
    rows.map((row) => [row.look, row.toneMapping, `${String(row.yavgMin)} to ${String(row.yavgMax)}`, formatNumber(row.htmlYavg, 1), formatNumber(row.threeYavg, 1), formatNumber(row.blenderYavg, 1), inBand(row.blenderYavg, row.yavgMin, row.yavgMax) ? 'yes' : 'no', formatSeconds(row.blenderMs)]),
  );
}
