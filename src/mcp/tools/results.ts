/**
 * From a command's result document to what a tool call returns: the JSON as
 * text in content[0], the same document as structuredContent, isError when
 * ok is false, plus any images a tool attaches. Errors raised before the
 * command runs (a refused path, an inline document that could not be
 * written, a wrong input type) become the same failure document runCommand
 * would build, so a model reads the same errors[].hint either way.
 */
import { failureResult } from '../../cli/result.ts';
import type { CliResult } from '../../cli/result.ts';
import { describeError } from '../../errors/vision-forge-error.ts';
import type { ToolContent, ToolResult } from '../types.ts';

/** A tool result from a command result: the JSON text first, the attached content after it. */
export function toolResultOf(result: CliResult, attached: readonly ToolContent[] = []): ToolResult {
  const content: ToolContent[] = [{ type: 'text', text: JSON.stringify(result) }, ...attached];
  return { content, structuredContent: { ...result }, isError: !result.ok };
}

/** The failure document for an error thrown before or around a command, as runCommand builds one for an error thrown inside it. */
export function failureResultOf(command: string, error: unknown): CliResult {
  const described = describeError(error);
  return failureResult(command, described.exitCode, { code: described.code, message: described.message, hint: described.hint }, described.evidence);
}

/** A failure tool result from a thrown error. */
export function failureToolResult(command: string, error: unknown): ToolResult {
  return toolResultOf(failureResultOf(command, error));
}

/** What a tool returns when it started a task instead of running inline. */
export interface TaskStartedPayload {
  readonly taskId: string;
  readonly tool: string;
  readonly status: 'running';
  readonly startedAt: string;
  readonly hint: string;
}

/** The tool result that hands a client a task id. */
export function taskStartedResult(taskId: string, tool: string, startedAt: string): ToolResult {
  const payload: TaskStartedPayload = {
    taskId,
    tool,
    status: 'running',
    startedAt,
    hint: `Call task_status with taskId "${taskId}" for the progress lines and, when it ends, the result; task_cancel stops it.`,
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: { ...payload }, isError: false };
}
