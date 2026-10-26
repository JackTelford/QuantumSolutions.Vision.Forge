/**
 * A scripted ProcessRunner for tests. Each expectation matches one invocation,
 * returns a canned result and may run a side effect (for example writing the
 * output files a real program would have written). Unexpected invocations
 * throw, so a test sees exactly which program would have been run.
 */
import type { ProcessResult, ProcessRunner, ProcessSpec } from '../../src/process/process-runner.ts';

/** Decides whether an expectation applies to a spec. */
export type SpecMatcher = (spec: ProcessSpec) => boolean;

interface Expectation {
  readonly matcher: SpecMatcher;
  readonly result: ProcessResult;
  readonly sideEffect: ((spec: ProcessSpec) => void) | undefined;
  used: boolean;
}

/** A successful result with optional output text. */
export function okResult(stdout = '', stderr = ''): ProcessResult {
  return { exitCode: 0, signal: null, stdout, stderr, elapsedMs: 1, timedOut: false };
}

/** A failed result with the given exit code and error text. */
export function failedResult(exitCode: number, stderr: string, stdout = ''): ProcessResult {
  return { exitCode, signal: null, stdout, stderr, elapsedMs: 1, timedOut: false };
}

/** Matches by the executable's file name (case-insensitive) and, when given, the exact argument array. */
export function matchProgram(fileName: string, args?: readonly string[]): SpecMatcher {
  return (spec: ProcessSpec): boolean => {
    const actualName = spec.executable.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    if (actualName !== fileName.toLowerCase()) return false;
    if (args === undefined) return true;
    return spec.args.length === args.length && spec.args.every((value, index) => value === args[index]);
  };
}

/** The scripted runner. */
export class FakeProcessRunner implements ProcessRunner {
  private readonly expectations: Expectation[] = [];
  /** Every spec that was run, in order. */
  readonly invocations: ProcessSpec[] = [];

  /** Adds an expectation. Expectations are consumed in the order they match. */
  expect(matcher: SpecMatcher, result: ProcessResult, sideEffect?: (spec: ProcessSpec) => void): void {
    this.expectations.push({ matcher, result, sideEffect, used: false });
  }

  /** Returns the canned result for the first unused matching expectation. */
  run(spec: ProcessSpec, signal: AbortSignal): Promise<ProcessResult> {
    this.invocations.push(spec);
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    const expectation = this.expectations.find((e) => !e.used && e.matcher(spec));
    if (expectation === undefined) {
      return Promise.reject(new Error(`Unexpected process run: ${spec.executable} ${spec.args.join(' ')}`));
    }
    expectation.used = true;
    expectation.sideEffect?.(spec);
    return Promise.resolve(expectation.result);
  }

  /** Throws when an expectation was never used. */
  assertAllUsed(): void {
    const unused = this.expectations.filter((e) => !e.used);
    if (unused.length > 0) throw new Error(`${unused.length} expected process run(s) never happened.`);
  }
}
