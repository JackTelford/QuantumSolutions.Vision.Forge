/**
 * loudness and true-peak: ebur128's end-of-stream summary against the
 * delivery targets. Integrated loudness must be within one LU of the
 * target (the plan's loudnessLufs, or -16); the true peak must not exceed
 * the ceiling (the plan's truePeakDbtp, or -1 dBTP). A file without an
 * audio stream skips both checks with a null measurement. A silent track
 * (ebur128 prints the -70 LUFS absolute gate as the integrated loudness and
 * -inf as the peak) fails loudness with a null measurement and passes
 * true-peak.
 */
import { DataFileError } from '../errors/vision-forge-error.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { Check } from '../shared/contracts/qa-report.ts';
import { makeCheck, round, runAnalysis, unmeasured } from './check.ts';
import { parseEbur128Summary } from './parse.ts';
import type { LoudnessSummary } from './parse.ts';
import { probeAudio } from './probe.ts';

/** Integrated loudness target in LUFS when neither the plan nor the command names one. */
export const defaultLoudnessTarget = -16;

/** True-peak ceiling in dBTP when the plan names none. */
export const defaultTruePeakCeiling = -1;

/** How far from the target the integrated loudness may be, in LU. */
export const loudnessToleranceLu = 1;

/** ebur128's absolute gate: it reports this, never -inf, as the integrated loudness of digital silence (verified with ffmpeg 9.0.2). */
export const ebur128AbsoluteGateLufs = -70;

/** The ebur128 run the checks share: audio only, with true-peak metering. */
export function loudnessArgs(path: string): readonly string[] {
  return ['-i', path, '-vn', '-af', 'ebur128=peak=true'];
}

/** Measures a file with ebur128; undefined when it has no audio stream. Throws DataFileError when ebur128 prints no summary. */
export async function measureLoudness(runner: ProcessRunner, ffmpegPath: string, ffprobePath: string, path: string, signal: AbortSignal): Promise<LoudnessSummary | undefined> {
  const audio = await probeAudio(runner, ffprobePath, path, signal);
  if (audio === undefined) return undefined;
  const result = await runAnalysis(runner, ffmpegPath, loudnessArgs(path), 'ffmpeg ebur128', signal);
  const summary = parseEbur128Summary(result.stderr);
  if (summary === undefined) throw new DataFileError(path, 'ebur128 printed no loudness summary', 'Check that the audio stream decodes; run ffmpeg with -af ebur128 by hand to see what it prints.');
  return summary;
}

/** loudness verdict: integrated loudness within loudnessToleranceLu of the target; silence (at or below the absolute gate) fails with a null measurement. */
export function judgeLoudness(summary: LoudnessSummary | undefined, target: number): Check {
  if (summary === undefined) return makeCheck('loudness', { ok: true, measured: null, threshold: target, unit: 'LUFS', detail: 'the file has no audio stream; skipped', frames: [] });
  const silent = !Number.isFinite(summary.integrated) || summary.integrated <= ebur128AbsoluteGateLufs;
  if (silent) return makeCheck('loudness', { ok: false, measured: null, threshold: target, unit: 'LUFS', detail: `the audio is silent (integrated loudness at or below the ${ebur128AbsoluteGateLufs} LUFS absolute gate)`, frames: [] });
  const difference = Math.abs(summary.integrated - target);
  const ok = difference <= loudnessToleranceLu;
  return makeCheck('loudness', {
    ok,
    measured: round(summary.integrated, 1),
    threshold: target,
    unit: 'LUFS',
    detail: `integrated loudness ${round(summary.integrated, 1)} LUFS, target ${target} LUFS within ${loudnessToleranceLu} LU${ok ? '' : ` (off by ${round(difference, 1)} LU)`}`,
    frames: [],
  });
}

/** true-peak verdict: the true peak at or under the ceiling. */
export function judgeTruePeak(summary: LoudnessSummary | undefined, ceiling: number): Check {
  if (summary === undefined) return makeCheck('true-peak', { ok: true, measured: null, threshold: ceiling, unit: 'dBTP', detail: 'the file has no audio stream; skipped', frames: [] });
  if (!Number.isFinite(summary.truePeak)) return makeCheck('true-peak', { ok: true, measured: null, threshold: ceiling, unit: 'dBTP', detail: 'no peak: the audio is silent', frames: [] });
  const ok = summary.truePeak <= ceiling;
  return makeCheck('true-peak', {
    ok,
    measured: round(summary.truePeak, 1),
    threshold: ceiling,
    unit: 'dBTP',
    detail: `true peak ${round(summary.truePeak, 1)} dBTP, ceiling ${ceiling} dBTP${ok ? '' : ` (over by ${round(summary.truePeak - ceiling, 1)} dB)`}`,
    frames: [],
  });
}

/** Measures once and returns the loudness and true-peak checks, in that order. */
export async function checkAudio(runner: ProcessRunner, ffmpegPath: string, ffprobePath: string, path: string, target: number, ceiling: number, signal: AbortSignal): Promise<readonly [Check, Check]> {
  try {
    const summary = await measureLoudness(runner, ffmpegPath, ffprobePath, path, signal);
    return [judgeLoudness(summary, target), judgeTruePeak(summary, ceiling)];
  } catch (error: unknown) {
    const loudness = unmeasured('loudness', 'LUFS', target, error);
    return [loudness, unmeasured('true-peak', 'dBTP', ceiling, error)];
  }
}
