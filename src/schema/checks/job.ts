/**
 * Semantic checks on a job that its schema cannot express: every shot entry
 * has its own id, a delivered job names its deliverable, and no shot has
 * had more still review rounds than the gate allows. Pure.
 */
import type { Job } from '../../shared/contracts/job.ts';
import { duplicateIds, runRules } from './rule.ts';
import type { CheckContext, Rule } from './rule.ts';

/** The most still review rounds a shot may have: the retry cap job.schema.json and qa-report.schema.json state. */
export const reviewRoundCap = 3;

function uniqueShotIds(job: Job): readonly string[] {
  return duplicateIds(job.shots.map((shot) => shot.id)).map((id) => `shot id "${id}" is used more than once`);
}

function deliveredHasPath(job: Job): readonly string[] {
  return job.status === 'delivered' && job.deliverablePath === null ? ['status is delivered but deliverablePath is null'] : [];
}

function roundsWithinCap(job: Job): readonly string[] {
  return job.shots.filter((shot) => shot.rounds > reviewRoundCap).map((shot) => `shot "${shot.id}" has ${shot.rounds} review rounds, over the cap of ${reviewRoundCap}`);
}

/** The job rules, in the order they run. */
export const jobRules: readonly Rule<Job>[] = [uniqueShotIds, deliveredHasPath, roundsWithinCap];

/** Problems with the job, one sentence each; empty when it is sound. */
export function checkJob(job: Job, context: CheckContext): readonly string[] {
  return runRules(jobRules, job, context);
}
