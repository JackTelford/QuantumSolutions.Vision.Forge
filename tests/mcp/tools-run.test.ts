import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PlanData } from '../../src/cli/commands/plan.ts';
import type { SheetData } from '../../src/cli/commands/sheet.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { commandTools } from '../../src/mcp/tools/index.ts';
import type { TaskStartedPayload } from '../../src/mcp/tools/results.ts';
import { TaskStatuses, TaskTable } from '../../src/mcp/tools/tasks.ts';
import type { TaskStatus } from '../../src/mcp/tools/tasks.ts';
import type { ServerPaths, ToolCallContext, ToolDefinition } from '../../src/mcp/types.ts';
import { jobId } from '../../src/plan/job.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { writeSolidPng } from '../fakes/png.ts';
import { planBrief, planLook, planShotSpec, planTreatment } from '../plan/fixtures.ts';
import { mutated } from '../schema/documents/examples.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const never = new AbortController().signal;
const ffmpeg = findFfmpeg();
const hasDrawtext = ffmpeg !== undefined && spawnSync(ffmpeg.path, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout.includes(' drawtext ');
const skipWithoutDrawtext = ffmpeg === undefined ? 'ffmpeg is not installed' : hasDrawtext ? false : 'ffmpeg has no drawtext filter';

function sleep(ms: number): Promise<void> {
  return new Promise((done) => { setTimeout(done, ms); });
}

describe('tools that run commands', () => {
  let dir = '';
  let paths: ServerPaths;
  let tools: readonly ToolDefinition[];
  const tasks = new TaskTable();
  const lines: string[] = [];
  let context: ToolCallContext;
  const tool = (name: string): ToolDefinition => {
    const found = tools.find((entry) => entry.name === name);
    assert.ok(found !== undefined, name);
    return found;
  };

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-mcp-run-'));
    paths = { dataDir: join(dir, 'data'), outDir: join(dir, 'out'), repositoryRoot: repoRoot };
    tools = commandTools(paths, tasks);
    context = { signal: never, report: (message) => { lines.push(message); }, ...paths };
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('sheet over three solid PNGs returns the sheet as an image beside the JSON', { skip: skipWithoutDrawtext }, async () => {
    const framesDir = join(paths.outDir, 'frames');
    for (const index of [0, 1, 2]) writeSolidPng(join(framesDir, `f${index}.png`), 64, 36, [40 + index * 20, 60, 80]);
    const result = await tool('sheet').run({ frames: 'frames', columns: 3 }, context);
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    const document = result.structuredContent as unknown as CliResult;
    const data = document.data as SheetData;
    assert.deepEqual([data.count, data.columns, data.rows], [3, 3, 1]);
    assert.equal(data.outputPath, join(paths.outDir, 'sheets', 'frames.png'));
    assert.equal(result.content.length, 2);
    assert.equal(result.content[0]?.type, 'text');
    const image = result.content[1];
    assert.equal(image?.type, 'image');
    if (image?.type !== 'image') return;
    assert.equal(image.mimeType, 'image/png');
    assert.equal(Buffer.from(image.data, 'base64').subarray(1, 4).toString('latin1'), 'PNG');
    assert.ok(lines.some((line) => /sheet: wrote/.test(line)));
  });

  it('render without wait returns a task id, and task_status reaches done with the shot-not-approved failure as its result', async () => {
    const planned = await tool('plan').run({
      brief: mutated(planBrief, (copy) => { copy.width = 320; copy.height = 180; }),
      treatment: planTreatment,
      shotSpec: mutated(planShotSpec, (copy) => { copy.width = 320; copy.height = 180; }),
      look: planLook,
    }, context);
    assert.equal(planned.isError, false, JSON.stringify(planned.structuredContent));
    const jobDir = ((planned.structuredContent as unknown as CliResult).data as PlanData).jobDir;

    const started = await tool('render').run({ job: jobDir, shot: 's03' }, context);
    assert.equal(started.isError, false);
    const payload = started.structuredContent as unknown as TaskStartedPayload;
    assert.match(payload.taskId, /^[0-9a-f]{8}$/);
    assert.equal(payload.status, 'running');
    assert.equal(payload.tool, 'render');
    assert.match(payload.hint, /task_status/);
    assert.deepEqual(JSON.parse((started.content[0] as { text: string }).text), payload);

    let status: TaskStatus | undefined;
    const deadline = Date.now() + 60_000;
    do {
      await sleep(50);
      const polled = await tool('task_status').run({ taskId: payload.taskId }, context);
      status = polled.structuredContent as unknown as TaskStatus;
      assert.ok(Date.now() < deadline, 'the render task ends within a minute');
    } while (status.status === TaskStatuses.running);
    assert.equal(status.status, TaskStatuses.done);
    assert.equal(status.result?.isError, true);
    const document = status.result?.structuredContent as unknown as CliResult;
    assert.equal(document.command, 'render');
    assert.equal(document.errors[0]?.code, 'shot-not-approved');
    assert.match(document.errors[0]?.hint ?? '', /still/);
    assert.equal(status.finishedAt === null, false);

    const cancelled = await tool('task_cancel').run({ taskId: payload.taskId }, context);
    assert.equal((cancelled.structuredContent as unknown as TaskStatus).status, TaskStatuses.done, 'a finished task stays as it ended');
  });

  it('render with wait runs inline and returns the same failure directly', async () => {
    const jobDir = join(paths.outDir, (await planJobId()));
    const result = await tool('render').run({ job: jobDir, shot: 's03', wait: true }, context);
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as unknown as CliResult).errors[0]?.code, 'shot-not-approved');
  });

  it('background true on any other tool returns a task id whose result is the command result', async () => {
    const started = await tool('audio_status').run({ background: true }, context);
    const payload = started.structuredContent as unknown as TaskStartedPayload;
    assert.equal(payload.tool, 'audio_status');
    let status = tasks.status(payload.taskId);
    const deadline = Date.now() + 30_000;
    while (status?.status === TaskStatuses.running && Date.now() < deadline) {
      await sleep(20);
      status = tasks.status(payload.taskId);
    }
    assert.equal(status?.status, TaskStatuses.done);
    assert.equal((status?.result?.structuredContent as unknown as CliResult).command, 'audio');
  });

  function planJobId(): Promise<string> {
    return jobId(mutated(planBrief, (copy) => { copy.width = 320; copy.height = 180; }), planTreatment, mutated(planShotSpec, (copy) => { copy.width = 320; copy.height = 180; }), planLook);
  }
});
