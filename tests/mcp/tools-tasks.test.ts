import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CliResult } from '../../src/cli/result.ts';
import { ExitCodes } from '../../src/errors/vision-forge-error.ts';
import { createCommandTool } from '../../src/mcp/tools/command-tool.ts';
import { findToolSpec } from '../../src/mcp/tools/index.ts';
import { TaskStatuses, TaskTable, taskLineCap } from '../../src/mcp/tools/tasks.ts';
import { taskCancelTool, taskStatusTool } from '../../src/mcp/tools/task-tools.ts';
import { WorkLane } from '../../src/mcp/tools/work-lane.ts';
import type { ServerPaths, ToolCallContext, ToolDefinition, ToolResult } from '../../src/mcp/types.ts';

const never = new AbortController().signal;
const context: ToolCallContext = { signal: never, report: () => undefined, dataDir: '', outDir: '', repositoryRoot: '' };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lanePaths: ServerPaths = { outDir: join(tmpdir(), 'vf-mcp-lane', 'out'), dataDir: join(tmpdir(), 'vf-mcp-lane', 'data'), repositoryRoot: repoRoot };
const waitingLine = (tool: string): string => `${tool}: waiting for the render lane, which another tool holds`;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => { setTimeout(done, ms); });
}

/** Resolves once the condition holds, polling; fails after the deadline. */
async function until(condition: () => boolean, what: string, deadlineMs = 5000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    assert.ok(Date.now() - started < deadlineMs, `timed out waiting for ${what}`);
    await sleep(10);
  }
}

const okResult: ToolResult = { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true }, isError: false };

describe('TaskTable', () => {
  it('starts a task running with a short hex id, collects its lines, and ends done with the result', async () => {
    const table = new TaskTable(() => new Date('2026-10-30T10:00:00.000Z'));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => { release = done; });
    const started = table.start('render', async (_signal, report) => {
      report('frame 1');
      await gate;
      report('frame 2');
      return okResult;
    });
    assert.match(started.taskId, /^[0-9a-f]{8}$/);
    assert.equal(started.startedAt, '2026-10-30T10:00:00.000Z');
    await sleep(0);
    const running = table.status(started.taskId);
    assert.deepEqual(running, { taskId: started.taskId, tool: 'render', status: TaskStatuses.running, startedAt: '2026-10-30T10:00:00.000Z', finishedAt: null, lines: ['frame 1'] });
    release();
    await until(() => table.status(started.taskId)?.status !== TaskStatuses.running, 'the task to end');
    const done = table.status(started.taskId);
    assert.equal(done?.status, TaskStatuses.done);
    assert.deepEqual(done?.lines, ['frame 1', 'frame 2']);
    assert.deepEqual(done?.result, okResult);
    assert.equal(done?.finishedAt, '2026-10-30T10:00:00.000Z');
    assert.deepEqual(table.ids(), [started.taskId]);
  });

  it('keeps only the last two hundred lines', async () => {
    const table = new TaskTable();
    const started = table.start('render', async (_signal, report) => {
      for (let index = 0; index < taskLineCap + 25; index += 1) report(`line ${index}`);
      return okResult;
    });
    await until(() => table.status(started.taskId)?.status === TaskStatuses.done, 'the task to end');
    const lines = table.status(started.taskId)?.lines ?? [];
    assert.equal(lines.length, taskLineCap);
    assert.equal(lines[0], 'line 25');
    assert.equal(lines[lines.length - 1], `line ${taskLineCap + 24}`);
  });

  it('cancel aborts the signal, ends the task cancelled whatever the run then returns, and leaves a finished task alone', async () => {
    const table = new TaskTable();
    let aborted = false;
    const started = table.start('render', (signal) => new Promise<ToolResult>((done) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        done({ content: [{ type: 'text', text: 'cancelled' }], isError: true });
      });
    }));
    const cancelled = table.cancel(started.taskId);
    assert.equal(cancelled?.status, TaskStatuses.cancelled);
    assert.deepEqual(cancelled?.lines, ['cancelled through task_cancel']);
    await until(() => aborted && table.status(started.taskId)?.result !== undefined, 'the run to see the abort');
    const after = table.status(started.taskId);
    assert.equal(after?.status, TaskStatuses.cancelled);
    assert.equal(after?.result?.isError, true);
    const finished = table.start('doctor', () => Promise.resolve(okResult));
    await until(() => table.status(finished.taskId)?.status === TaskStatuses.done, 'the quick task to end');
    assert.equal(table.cancel(finished.taskId)?.status, TaskStatuses.done);
    assert.equal(table.cancel('nope'), undefined);
    assert.equal(table.status('nope'), undefined);
  });

  it('ends a task whose run rejects as failed, with the error as a failure result', async () => {
    const table = new TaskTable();
    const started = table.start('sheet', () => Promise.reject(new Error('boom')));
    await until(() => table.status(started.taskId)?.status !== TaskStatuses.running, 'the task to end');
    const status = table.status(started.taskId);
    assert.equal(status?.status, TaskStatuses.failed);
    assert.equal(status?.result?.isError, true);
    const document = status?.result?.structuredContent as { command: string; errors: { code: string; message: string }[] };
    assert.equal(document.command, 'sheet');
    assert.equal(document.errors[0]?.code, 'unexpected');
    assert.equal(document.errors[0]?.message, 'boom');
  });

  it('cancelAll aborts every running task', async () => {
    const table = new TaskTable();
    const a = table.start('render', (signal) => new Promise<ToolResult>((done) => { signal.addEventListener('abort', () => done(okResult)); }));
    const b = table.start('assemble', (signal) => new Promise<ToolResult>((done) => { signal.addEventListener('abort', () => done(okResult)); }));
    table.cancelAll();
    await until(() => table.status(a.taskId)?.result !== undefined && table.status(b.taskId)?.result !== undefined, 'both runs to end');
    assert.deepEqual([table.status(a.taskId)?.status, table.status(b.taskId)?.status], [TaskStatuses.cancelled, TaskStatuses.cancelled]);
    assert.deepEqual(table.status(a.taskId)?.lines, ['the server is shutting down']);
  });
});

describe('task_status and task_cancel tools', () => {
  it('report a task, mark a failed task isError, and answer an unknown or missing id with code task-not-found', async () => {
    const table = new TaskTable();
    const status = taskStatusTool(table);
    const cancel = taskCancelTool(table);
    const started = table.start('render', (signal) => new Promise<ToolResult>((done) => { signal.addEventListener('abort', () => done(okResult)); }));
    const running = await status.run({ taskId: started.taskId }, context);
    assert.equal(running.isError, false);
    assert.equal((running.structuredContent as { status: string }).status, TaskStatuses.running);
    assert.equal(JSON.parse((running.content[0] as { text: string }).text).taskId, started.taskId);
    const cancelled = await cancel.run({ taskId: started.taskId }, context);
    assert.equal((cancelled.structuredContent as { status: string }).status, TaskStatuses.cancelled);
    for (const tool of [status, cancel]) {
      const unknown = await tool.run({ taskId: 'nope' }, context);
      assert.equal(unknown.isError, true);
      const document = unknown.structuredContent as { command: string; errors: { code: string; hint: string }[] };
      assert.equal(document.command, tool.name);
      assert.equal(document.errors[0]?.code, 'task-not-found');
      assert.match(document.errors[0]?.hint ?? '', /do not survive a restart/);
      const missing = await tool.run({}, context);
      assert.equal((missing.structuredContent as { errors: { message: string }[] }).errors[0]?.message, 'Missing "taskId".');
      const extra = await tool.run({ taskId: started.taskId, verbose: true }, context);
      assert.equal((extra.structuredContent as { errors: { code: string }[] }).errors[0]?.code, 'usage');
    }
    const failed = table.start('qa', () => Promise.reject(new Error('no')));
    await until(() => table.status(failed.taskId)?.status === TaskStatuses.failed, 'the failing task to end');
    assert.equal((await status.run({ taskId: failed.taskId }, context)).isError, true);
  });
});

describe('WorkLane', () => {
  it('runs the work handed to it one piece at a time, in order, and reports busy while any waits', async () => {
    const lane = new WorkLane();
    const order: string[] = [];
    assert.equal(lane.isBusy(), false);
    let releaseFirst: () => void = () => undefined;
    const first = lane.run(async () => {
      order.push('first starts');
      await new Promise<void>((done) => { releaseFirst = done; });
      order.push('first ends');
      return 1;
    });
    const second = lane.run(() => { order.push('second'); return Promise.resolve(2); });
    assert.equal(lane.isBusy(), true);
    await sleep(0);
    assert.deepEqual(order, ['first starts']);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(order, ['first starts', 'first ends', 'second']);
    await sleep(0);
    assert.equal(lane.isBusy(), false);
    await assert.rejects(lane.run(() => Promise.reject(new Error('bad'))), /bad/);
    assert.equal(await lane.run(() => Promise.resolve('after a failure')), 'after a failure');
  });
});

describe('exclusive tools over one lane', () => {
  /** A call context over the lane paths that keeps every reported line. */
  function laneContext(signal: AbortSignal = never): ToolCallContext & { readonly lines: string[] } {
    const lines: string[] = [];
    return { signal, report: (message) => { lines.push(message); }, ...lanePaths, lines };
  }

  /** A lane held by a piece of work that ends only when release is called. */
  function heldLane(): { readonly lane: WorkLane; readonly release: () => void } {
    const lane = new WorkLane();
    let done: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { done = resolve; });
    void lane.run(() => gate);
    // A closure, not the value: the lane starts its work on a later microtask, after this returns.
    return { lane, release: () => { done(); } };
  }

  function tool(name: string, tasks: TaskTable, lane: WorkLane): ToolDefinition {
    const spec = findToolSpec(name);
    assert.ok(spec !== undefined, name);
    assert.equal(spec.exclusive, true, `${name} is exclusive`);
    return createCommandTool(spec, tasks, lane);
  }

  const documentOf = (result: ToolResult | undefined): CliResult => result?.structuredContent as unknown as CliResult;

  it('a background exclusive task and a later inline exclusive call both wait behind the held lane, say so, and run once it frees', async () => {
    const tasks = new TaskTable();
    const { lane, release } = heldLane();
    const inlineContext = laneContext();
    const started = await tool('sheet', tasks, lane).run({ frames: 'missing-frames', background: true }, laneContext());
    assert.equal(started.isError, false);
    const taskId = (started.structuredContent as { taskId: string }).taskId;
    const inline = tool('qa', tasks, lane).run({ job: 'missing-job' }, inlineContext);
    let settled = false;
    void inline.then(() => { settled = true; }, () => { settled = true; });
    await sleep(50);
    assert.equal(settled, false, 'the inline call is still waiting for the lane');
    assert.equal(tasks.status(taskId)?.status, TaskStatuses.running);
    assert.deepEqual(tasks.status(taskId)?.lines, [waitingLine('sheet')]);
    assert.deepEqual(inlineContext.lines, [waitingLine('qa')]);
    release();
    const result = await inline;
    assert.equal(result.isError, true, 'there is no such job, so qa fails once it runs');
    assert.equal(documentOf(result).command, 'qa');
    assert.notEqual(documentOf(result).errors[0]?.code, 'cancelled');
    await until(() => tasks.status(taskId)?.status !== TaskStatuses.running, 'the sheet task to end');
    assert.equal(tasks.status(taskId)?.status, TaskStatuses.done);
    assert.equal(documentOf(tasks.status(taskId)?.result).command, 'sheet');
    await sleep(0);
    assert.equal(lane.isBusy(), false);
  });

  it('a task cancelled while it waits for the lane never enters the command: code cancelled, exit 130, no command log line', async () => {
    const tasks = new TaskTable();
    const { lane, release } = heldLane();
    const started = await tool('sheet', tasks, lane).run({ frames: 'missing-frames', background: true }, laneContext());
    const taskId = (started.structuredContent as { taskId: string }).taskId;
    assert.equal(tasks.cancel(taskId)?.status, TaskStatuses.cancelled);
    release();
    await until(() => tasks.status(taskId)?.result !== undefined, 'the cancelled task to settle');
    const status = tasks.status(taskId);
    assert.equal(status?.status, TaskStatuses.cancelled);
    const document = documentOf(status?.result);
    assert.equal(document.command, 'sheet');
    assert.equal(document.errors[0]?.code, 'cancelled');
    assert.equal(document.exitCode, ExitCodes.cancelled);
    assert.deepEqual(status?.lines, [waitingLine('sheet'), 'cancelled through task_cancel']);
  });

  it('an inline call whose signal is already aborted answers cancelled without joining the lane', async () => {
    const lane = new WorkLane();
    const result = await tool('qa', new TaskTable(), lane).run({ job: 'missing-job' }, laneContext(AbortSignal.abort()));
    assert.equal(documentOf(result).errors[0]?.code, 'cancelled');
    assert.equal(lane.isBusy(), false);
  });
});
