/**
 * Long work as a task (ADR 0009 decision 6): a render can take minutes and
 * most clients time out a tool call near a minute, so a tool started in the
 * background returns a task id at once. The table keeps every task of the
 * session, running or finished, with the last two hundred progress lines
 * and, once it ends, the tool result; cancel aborts the task's signal, and a
 * cancelled command resumes on the next call like one stopped with Ctrl+C.
 */
import { randomBytes } from 'node:crypto';
import type { ToolResult } from '../types.ts';
import { failureToolResult } from './results.ts';

/** The states a task passes through. */
export const TaskStatuses = { running: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled' } as const;

/** One of the values in TaskStatuses. */
export type TaskStatusName = (typeof TaskStatuses)[keyof typeof TaskStatuses];

/** How many progress lines a task keeps: the most recent ones. */
export const taskLineCap = 200;

/** What a task runs: given a signal to honour and a sink for progress, returns the tool result. */
export type TaskRun = (signal: AbortSignal, report: (message: string) => void) => Promise<ToolResult>;

/** What start returns. */
export interface TaskStarted {
  readonly taskId: string;
  /** RFC 3339. */
  readonly startedAt: string;
}

/** What status returns: the task's state and, once it has ended, its result. */
export interface TaskStatus {
  readonly taskId: string;
  readonly tool: string;
  readonly status: TaskStatusName;
  readonly startedAt: string;
  /** RFC 3339; null while running. */
  readonly finishedAt: string | null;
  /** The last progress lines, oldest first. */
  readonly lines: readonly string[];
  readonly result?: ToolResult;
}

interface TaskRecord {
  readonly taskId: string;
  readonly tool: string;
  status: TaskStatusName;
  readonly startedAt: string;
  finishedAt: string | null;
  readonly lines: string[];
  result: ToolResult | undefined;
  readonly controller: AbortController;
}

/** The tasks of one server session. */
export class TaskTable {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  /** Starts the run under a fresh id; the run's rejection, should it reject, ends the task failed with the error as its result. */
  start(tool: string, run: TaskRun): TaskStarted {
    const taskId = this.freshId();
    const record: TaskRecord = { taskId, tool, status: TaskStatuses.running, startedAt: this.now().toISOString(), finishedAt: null, lines: [], result: undefined, controller: new AbortController() };
    this.tasks.set(taskId, record);
    const report = (message: string): void => {
      record.lines.push(message);
      if (record.lines.length > taskLineCap) record.lines.splice(0, record.lines.length - taskLineCap);
    };
    run(record.controller.signal, report).then(
      // A command that failed still ended cleanly: the task is done and its result says what went wrong.
      (result) => { this.finish(record, result, TaskStatuses.done); },
      (error: unknown) => { this.finish(record, failureToolResult(tool, error), TaskStatuses.failed); },
    );
    return { taskId, startedAt: record.startedAt };
  }

  /** The task's state, or undefined for an id this session never issued. */
  status(taskId: string): TaskStatus | undefined {
    const record = this.tasks.get(taskId);
    return record === undefined ? undefined : snapshot(record);
  }

  /** Aborts a running task's signal and marks it cancelled; a finished task is left as it ended. Undefined for an unknown id. */
  cancel(taskId: string, reason = 'cancelled through task_cancel'): TaskStatus | undefined {
    const record = this.tasks.get(taskId);
    if (record === undefined) return undefined;
    if (record.status === TaskStatuses.running) {
      record.status = TaskStatuses.cancelled;
      record.lines.push(reason);
      record.controller.abort(reason);
    }
    return snapshot(record);
  }

  /** Every task id issued, oldest first. */
  ids(): readonly string[] {
    return [...this.tasks.keys()];
  }

  /** Aborts every running task, for a server shutting down. */
  cancelAll(reason = 'the server is shutting down'): void {
    for (const taskId of this.tasks.keys()) this.cancel(taskId, reason);
  }

  private finish(record: TaskRecord, result: ToolResult, status: TaskStatusName): void {
    record.result = result;
    record.finishedAt = this.now().toISOString();
    // A cancelled task stays cancelled whatever the aborted run returned.
    if (record.status === TaskStatuses.running) record.status = status;
  }

  private freshId(): string {
    let id = randomBytes(4).toString('hex');
    while (this.tasks.has(id)) id = randomBytes(4).toString('hex');
    return id;
  }
}

function snapshot(record: TaskRecord): TaskStatus {
  return {
    taskId: record.taskId,
    tool: record.tool,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    lines: [...record.lines],
    ...(record.result === undefined ? {} : { result: record.result }),
  };
}
