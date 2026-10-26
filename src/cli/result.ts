/**
 * The one JSON document every command prints on standard output. Claude
 * parses it; tests assert on it; `schemas/cli-result.schema.json` describes it.
 */
import type { ExitCode } from '../errors/vision-forge-error.ts';

/** One error entry in a result. */
export interface CliResultError {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
}

/** The result document. */
export interface CliResult {
  readonly kind: 'cli-result';
  readonly version: 1;
  readonly command: string;
  readonly ok: boolean;
  readonly exitCode: ExitCode;
  /** Command-specific payload; each command documents its shape. */
  readonly data: unknown;
  /** Absolute paths of files the command produced for the user. */
  readonly artifacts: readonly string[];
  readonly errors: readonly CliResultError[];
  /** Absolute paths of evidence files (reports, contact sheets) the command wrote. */
  readonly evidence: readonly string[];
}

/** What a command returns on success. */
export interface CommandOutput {
  readonly data: unknown;
  readonly artifacts?: readonly string[];
  readonly evidence?: readonly string[];
}

/** Builds a successful result. */
export function successResult(command: string, output: CommandOutput): CliResult {
  return {
    kind: 'cli-result',
    version: 1,
    command,
    ok: true,
    exitCode: 0,
    data: output.data,
    artifacts: output.artifacts ?? [],
    evidence: output.evidence ?? [],
    errors: [],
  };
}

/** Builds a failed result. */
export function failureResult(command: string, exitCode: ExitCode, error: CliResultError): CliResult {
  return {
    kind: 'cli-result',
    version: 1,
    command,
    ok: false,
    exitCode,
    data: null,
    artifacts: [],
    evidence: [],
    errors: [error],
  };
}

/** Serializes a result for standard output: compact by default, indented when pretty. */
export function serializeResult(result: CliResult, pretty: boolean): string {
  return `${pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)}\n`;
}
