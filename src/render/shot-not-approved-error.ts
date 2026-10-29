/**
 * The error render raises for a shot that has not passed the still gate:
 * the gate is the one place taste enters before frames are spent (ADR 0004
 * decision 6), so render refuses unless told otherwise.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';

/** A shot is not approved for rendering; the hint names the still command to run. */
export class ShotNotApprovedError extends VisionForgeError {
  readonly shotId: string;

  constructor(shotId: string, reason: string, jobDir: string) {
    super({
      code: 'shot-not-approved',
      message: `Shot "${shotId}" is not approved for rendering: ${reason}.`,
      hint: `Run "node scripts/cli.ts still --job ${jobDir} --shot ${shotId}", look at the still, then "still --job ${jobDir} --shot ${shotId} --approve"; or pass --allow-unapproved to render anyway.`,
    });
    this.shotId = shotId;
  }
}
