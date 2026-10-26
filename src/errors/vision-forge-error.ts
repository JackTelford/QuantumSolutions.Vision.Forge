/**
 * Error classes shared by every command.
 *
 * Each error carries a stable code, a message that says what went wrong and
 * a hint that says what to do next. The CLI prints the message and the hint,
 * never a stack trace, and exits with the error's exit code.
 */

/** Process exit codes used by the CLI. */
export const ExitCodes = {
  success: 0,
  failure: 1,
  usage: 2,
  cancelled: 130,
} as const;

/** One of the values in ExitCodes. */
export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

/** Fields every VisionForgeError is built from. */
export interface VisionForgeErrorFields {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly exitCode?: ExitCode;
  readonly cause?: unknown;
}

/** Base class: an actionable failure with a code, a hint and an exit code. */
export class VisionForgeError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly exitCode: ExitCode;

  constructor(fields: VisionForgeErrorFields) {
    super(fields.message);
    this.name = new.target.name;
    this.code = fields.code;
    this.hint = fields.hint;
    this.exitCode = fields.exitCode ?? ExitCodes.failure;
    if (fields.cause !== undefined) {
      this.cause = fields.cause;
    }
  }
}

/** The command line was wrong: unknown command, unknown option, missing value. Exit 2. */
export class UsageError extends VisionForgeError {
  constructor(message: string, hint: string) {
    super({ code: 'usage', message, hint, exitCode: ExitCodes.usage });
  }
}

/** The user interrupted the command (Ctrl+C). Exit 130. */
export class CancelledError extends VisionForgeError {
  constructor() {
    super({ code: 'cancelled', message: 'The command was cancelled.', hint: 'Run it again to resume; finished shots are kept.', exitCode: ExitCodes.cancelled });
  }
}

/** A command exists in the plan but is not implemented in this milestone yet. Exit 2. */
export class NotImplementedError extends VisionForgeError {
  readonly command: string;
  readonly milestone: string;

  constructor(command: string, milestone: string) {
    super({
      code: 'not-implemented',
      message: `The "${command}" command is not implemented yet.`,
      hint: `It is planned for milestone ${milestone}. See docs/handoff.md for the current state.`,
      exitCode: ExitCodes.usage,
    });
    this.command = command;
    this.milestone = milestone;
  }
}

/** A required external program was not found. */
export class ToolMissingError extends VisionForgeError {
  readonly tool: string;

  constructor(tool: string, installHint: string) {
    super({ code: 'tool-missing', message: `${tool} was not found.`, hint: installHint });
    this.tool = tool;
  }
}

/** An external program was found but its version is not supported. */
export class ToolVersionError extends VisionForgeError {
  readonly tool: string;
  readonly found: string;
  readonly required: string;

  constructor(tool: string, found: string, required: string, installHint: string) {
    super({ code: 'tool-version', message: `${tool} ${found} is installed, but ${required} is required.`, hint: installHint });
    this.tool = tool;
    this.found = found;
    this.required = required;
  }
}

/** A path given as an executable is not an absolute path to a real program file. */
export class InvalidExecutableError extends VisionForgeError {
  readonly path: string;

  constructor(path: string, reason: string) {
    super({
      code: 'invalid-executable',
      message: `Cannot run "${path}": ${reason}.`,
      hint: 'Programs are spawned without a shell and must be absolute paths to real executables, never .cmd or .bat files.',
    });
    this.path = path;
  }
}

/** An external program ran and reported failure. */
export class ProcessFailedError extends VisionForgeError {
  readonly tool: string;
  readonly processExitCode: number | null;
  readonly stderrTail: string;
  readonly logPath: string | undefined;

  constructor(tool: string, processExitCode: number | null, stderrTail: string, logPath: string | undefined, hint: string) {
    super({
      code: 'process-failed',
      message: `${tool} failed with exit code ${processExitCode === null ? 'none (killed)' : String(processExitCode)}.${stderrTail.length > 0 ? ` Last output: ${stderrTail}` : ''}`,
      hint: logPath === undefined ? hint : `${hint} Full log: ${logPath}`,
    });
    this.tool = tool;
    this.processExitCode = processExitCode;
    this.stderrTail = stderrTail;
    this.logPath = logPath;
  }
}

/** An external program exceeded its time limit and was killed. */
export class ProcessTimeoutError extends VisionForgeError {
  readonly tool: string;
  readonly timeoutMs: number;

  constructor(tool: string, timeoutMs: number) {
    super({
      code: 'process-timeout',
      message: `${tool} did not finish within ${Math.round(timeoutMs / 1000)} s and was stopped.`,
      hint: 'Reduce the shot size or sample count, or raise the budget with --max-minutes.',
    });
    this.tool = tool;
    this.timeoutMs = timeoutMs;
  }
}

/** A JSON document did not match its schema. */
export class SchemaValidationError extends VisionForgeError {
  readonly kind: string;
  readonly problems: readonly string[];

  constructor(kind: string, problems: readonly string[]) {
    super({
      code: 'schema-validation',
      message: `The ${kind} document is invalid: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ''}.`,
      hint: `Fix the listed paths. The schema is schemas/${kind}.schema.json.`,
    });
    this.kind = kind;
    this.problems = problems;
  }
}

/** A file on disk could not be read as the JSON document it should be. */
export class DataFileError extends VisionForgeError {
  readonly path: string;

  constructor(path: string, reason: string, hint: string) {
    super({ code: 'data-file', message: `Cannot read ${path}: ${reason}.`, hint });
    this.path = path;
  }
}

/** A downloaded file did not have the expected size or hash. */
export class DownloadIntegrityError extends VisionForgeError {
  readonly url: string;
  readonly expected: string;
  readonly actual: string;

  constructor(url: string, what: 'size' | 'sha256' | 'md5', expected: string, actual: string) {
    super({
      code: 'download-integrity',
      message: `The download from ${url} has the wrong ${what}: expected ${expected}, got ${actual}.`,
      hint: 'The partial file was removed. Run the command again; if it fails twice, the pinned source has changed and the pin must be reviewed.',
    });
    this.url = url;
    this.expected = expected;
    this.actual = actual;
  }
}

/** A URL (or a redirect target) points at a host outside the network allowlist. */
export class NetworkNotAllowedError extends VisionForgeError {
  readonly host: string;

  constructor(host: string, url: string) {
    super({
      code: 'network-not-allowed',
      message: `Refusing to contact ${host} (${url}): it is not on the network allowlist.`,
      hint: 'The allowlist is in src/net/allowlist.ts and documented in docs/research.md. Downloads only come from approved hosts.',
    });
    this.host = host;
  }
}

/** A path would exceed the Windows path limit. */
export class PathTooLongError extends VisionForgeError {
  readonly path: string;
  readonly limit: number;

  constructor(path: string, limit: number) {
    super({
      code: 'path-too-long',
      message: `The path is ${path.length} characters, over the limit of ${limit}: ${path}`,
      hint: 'Use a shorter --out or --data-dir (for example C:\\vf), or enable long paths in Windows.',
    });
    this.path = path;
    this.limit = limit;
  }
}

/** Returns the error's message and hint for display, for any thrown value. */
export function describeError(error: unknown): { readonly message: string; readonly hint: string; readonly code: string; readonly exitCode: ExitCode } {
  if (error instanceof VisionForgeError) {
    return { message: error.message, hint: error.hint, code: error.code, exitCode: error.exitCode };
  }
  if (error instanceof Error) {
    return { message: error.message, hint: 'This was not expected. The stack trace is in the log file under the data directory.', code: 'unexpected', exitCode: ExitCodes.failure };
  }
  return { message: String(error), hint: 'This was not expected.', code: 'unexpected', exitCode: ExitCodes.failure };
}
