/**
 * task_status and task_cancel (ADR 0009 decision 6): the two tools over the
 * task table. Neither runs a command, so their results are built here: the
 * task's state as JSON text and as structuredContent, or a failure document
 * with code task-not-found for an id this session never issued.
 */
import { ExitCodes, VisionForgeError } from '../../errors/vision-forge-error.ts';
import type { ToolCallContext, ToolDefinition, ToolResult } from '../types.ts';
import { plainInputSchema, readOnlyAnnotations, stringProperty, localWriteAnnotations } from './definitions.ts';
import { assertKnownKeys, readString } from './inputs.ts';
import { failureToolResult } from './results.ts';
import type { TaskStatus, TaskTable } from './tasks.ts';

/** The error an unknown task id raises. */
export function taskNotFound(taskId: string | undefined): VisionForgeError {
  return new VisionForgeError({
    code: 'task-not-found',
    message: taskId === undefined ? 'Missing "taskId".' : `No task "${taskId}" in this session.`,
    hint: 'The id comes from a tool call with background true, or render without wait, in this server session; ids do not survive a restart.',
    exitCode: ExitCodes.usage,
  });
}

/** A task's state as a tool result: the status document as text and as structuredContent; isError only when the task itself failed. */
export function taskStatusResult(status: TaskStatus): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(status) }], structuredContent: { ...status }, isError: status.status === 'failed' };
}

/** task_status: the progress lines and, when it ended, the result of a task. */
export function taskStatusTool(tasks: TaskTable): ToolDefinition {
  return {
    name: 'task_status',
    description: 'The state of a task started with background true or by render: status running, done, failed or cancelled; lines, the last 200 progress lines; and, once it ended, result, the tool result it would have returned inline (its structuredContent is the command\'s result document, isError true when the command failed). Poll it every few seconds while a render runs and relay the estimate lines to the user.',
    inputSchema: plainInputSchema({ taskId: stringProperty('The task id the starting call returned.') }, ['taskId']),
    annotations: readOnlyAnnotations,
    exclusive: false,
    run(input: Record<string, unknown>, _context: ToolCallContext): Promise<ToolResult> {
      try {
        assertKnownKeys(input, ['taskId'], 'task_status');
        const taskId = readString(input, 'taskId');
        const status = taskId === undefined ? undefined : tasks.status(taskId);
        if (status === undefined) throw taskNotFound(taskId);
        return Promise.resolve(taskStatusResult(status));
      } catch (error: unknown) {
        return Promise.resolve(failureToolResult('task_status', error));
      }
    },
  };
}

/** task_cancel: abort a running task; finished shots are kept and a render resumes on the next call. */
export function taskCancelTool(tasks: TaskTable): ToolDefinition {
  return {
    name: 'task_cancel',
    description: 'Stops a running task: its signal is aborted, the command ends with code cancelled and the task reads cancelled. Finished frames and shots are kept, so a render stopped here resumes where it was on the next render call. A task that already ended is left as it ended.',
    inputSchema: plainInputSchema({ taskId: stringProperty('The task id to stop.') }, ['taskId']),
    annotations: localWriteAnnotations,
    exclusive: false,
    run(input: Record<string, unknown>, _context: ToolCallContext): Promise<ToolResult> {
      try {
        assertKnownKeys(input, ['taskId'], 'task_cancel');
        const taskId = readString(input, 'taskId');
        const status = taskId === undefined ? undefined : tasks.cancel(taskId);
        if (status === undefined) throw taskNotFound(taskId);
        return Promise.resolve(taskStatusResult(status));
      } catch (error: unknown) {
        return Promise.resolve(failureToolResult('task_cancel', error));
      }
    },
  };
}
