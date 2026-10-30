/**
 * `still --approve`: nothing renders; the latest still of the shot must
 * exist and its gate report must have passed, and the shot becomes
 * still-approved, which is what render looks for.
 */
import { VisionForgeError } from '../../errors/vision-forge-error.ts';
import { findJobShot, saveJob, updateShot } from '../../render/job-state.ts';
import type { LoadedJob } from '../../render/job-state.ts';
import { StillGateError } from '../../render/still-gate-error.ts';
import { describeFailures, gateReportPath, readGateReport } from '../../render/still-gate.ts';
import type { CommandOutput } from '../result.ts';

/** Shape of the --approve payload. */
export interface ApproveData {
  readonly jobId: string;
  readonly shotId: string;
  readonly status: 'still-approved';
}

/** Marks the latest still approved; the shot must be still-rendered and its gate report passed. */
export function approve(loaded: LoadedJob, shotId: string): CommandOutput {
  const jobShot = findJobShot(loaded.job, shotId);
  if (jobShot.status !== 'still-rendered' || jobShot.stillPath === null) {
    throw new VisionForgeError({
      code: 'still-not-rendered',
      message: `Shot "${shotId}" has no still to approve; its status is ${jobShot.status}.`,
      hint: `Run still --job ${loaded.folder.dir} --shot ${shotId} first and look at the still before approving it.`,
    });
  }
  const reportPath = gateReportPath(jobShot.stillPath);
  const report = readGateReport(reportPath);
  if (!report.passed) throw new StillGateError(shotId, describeFailures(report), reportPath, jobShot.stillPath);
  saveJob(loaded.folder, updateShot(loaded.job, shotId, { status: 'still-approved' }));
  const data: ApproveData = { jobId: loaded.job.id, shotId, status: 'still-approved' };
  return { data, artifacts: [], evidence: [reportPath] };
}
