/** @generated from schemas/cli-result.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Process exit code: 0 success, 1 failure, 2 usage error, 130 cancelled.
 *
 * This interface was referenced by `CliResult`'s JSON-Schema
 * via the `definition` "ExitCode".
 */
export type ExitCode = 0 | 1 | 2 | 130;

/**
 * The one JSON document every CLI command prints on standard output. Built by src/cli/result.ts; Claude parses it and tests assert on it.
 */
export interface CliResult {
  /**
   * Document kind; always "cli-result".
   */
  kind: 'cli-result';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * Name of the command that ran, for example "doctor"; empty when no command was given.
   */
  command: string;
  /**
   * True when the command succeeded and exitCode is 0.
   */
  ok: boolean;
  exitCode: ExitCode;
  /**
   * Command-specific payload: any JSON value, null when the command failed. Each command documents its shape.
   */
  data: unknown;
  /**
   * Absolute paths of the files the command produced for the user, in the order they were written.
   *
   * Items: Absolute file path.
   */
  artifacts: string[];
  /**
   * The errors that stopped the command; empty when ok is true.
   */
  errors: CliResultError[];
  /**
   * Absolute paths of the evidence files (reports, contact sheets) the command wrote.
   *
   * Items: Absolute file path.
   */
  evidence: string[];
}
/**
 * One error entry: a stable code, what went wrong and what to do next.
 *
 * This interface was referenced by `CliResult`'s JSON-Schema
 * via the `definition` "CliResultError".
 */
export interface CliResultError {
  /**
   * Stable machine-readable error code, for example "usage" or "tool-missing".
   */
  code: string;
  /**
   * What went wrong, one sentence for a person.
   */
  message: string;
  /**
   * What to do next, one sentence for a person.
   */
  hint: string;
}

/** Every ExitCode value the schema allows, in schema order. */
export const ExitCodeValues = [0, 1, 2, 130] as const;
