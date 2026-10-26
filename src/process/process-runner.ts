/**
 * The seam between commands and external programs.
 *
 * Commands never spawn processes themselves. They describe a run as a
 * ProcessSpec and hand it to a ProcessRunner. Production uses
 * ChildProcessRunner; tests use the scripted fake under tests/fakes/, which
 * lets every ffmpeg, Blender and browser decision run on a machine without
 * those programs.
 */

/** One external program invocation. */
export interface ProcessSpec {
  /** Short name used in errors and logs, for example "ffmpeg". */
  readonly label: string;
  /** Absolute path of a real executable. Never a .cmd or .bat file. */
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Extra environment variables layered over the current process environment. */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Bytes written to the program's standard input, then closed. */
  readonly stdin?: Uint8Array;
  /** When set, standard output is also written to this file. */
  readonly stdoutFile?: string;
  /** When set, standard error is also written to this file. */
  readonly stderrFile?: string;
}

/** What happened when a program ran. A non-zero exit code is a result, not an exception. */
export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
}

/** Runs external programs. */
export interface ProcessRunner {
  run(spec: ProcessSpec, signal: AbortSignal): Promise<ProcessResult>;
}

/** The last `maxChars` characters of a program's standard error, on one line, for error messages. */
export function stderrTail(stderr: string, maxChars = 400): string {
  const compact = stderr.replace(/\s+/g, ' ').trim();
  return compact.length <= maxChars ? compact : `…${compact.slice(compact.length - maxChars)}`;
}
