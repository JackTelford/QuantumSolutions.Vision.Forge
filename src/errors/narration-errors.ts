/**
 * The errors of the optional narration component (ADR 0007). Each one is a
 * VisionForgeError with a stable code the CLI result carries:
 * `narration-not-installed` when a command needs the component and it is
 * not there, `npm-missing` when npm's entry script is not beside the running
 * Node, `npm-install-failed` when `npm ci` did not leave the packages behind,
 * and `weights-download-failed` when one of the pinned model files could not
 * be fetched or verified. Every hint names the command that repairs it.
 */
import { VisionForgeError } from './vision-forge-error.ts';

/** The install command the hints name; the skill passes --data-dir itself. */
export const installCommandHint = 'Run audio install --yes (node scripts/cli.ts audio install --yes --data-dir <dir>) to install the narration component.';

/** The component is absent or incomplete; `missing` lists what componentStatus found wanting. */
export class NarrationNotInstalledError extends VisionForgeError {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super({
      code: 'narration-not-installed',
      message: `The narration component is not installed${missing.length > 0 ? `: ${missing.join('; ')}` : ''}.`,
      hint: installCommandHint,
    });
    this.missing = [...missing];
  }
}

/** npm-cli.js was not found beside the Node that is running; the paths tried are in the message. */
export class NpmMissingError extends VisionForgeError {
  readonly tried: readonly string[];

  constructor(execPath: string, tried: readonly string[]) {
    super({
      code: 'npm-missing',
      message: `npm's entry script was not found beside ${execPath}; tried ${tried.join(', ')}.`,
      hint: 'Install Node.js from nodejs.org (it ships npm beside node), or run the command with that Node, and run audio install --yes again.',
    });
    this.tried = [...tried];
  }
}

/** `npm ci` exited non-zero, timed out, or finished without the two packages. */
export class NpmInstallFailedError extends VisionForgeError {
  readonly reason: string;

  constructor(reason: string, hint: string) {
    super({ code: 'npm-install-failed', message: `npm ci of the narration component failed: ${reason}`, hint });
    this.reason = reason;
  }
}

/** A pinned weight file could not be downloaded or did not verify; the downloader's own sentence is kept. */
export class WeightsDownloadFailedError extends VisionForgeError {
  readonly file: string;

  constructor(file: string, cause: VisionForgeError) {
    super({
      code: 'weights-download-failed',
      message: `The pinned model file ${file} could not be downloaded: ${cause.message}`,
      hint: cause.hint,
      cause,
    });
    this.file = file;
  }
}
