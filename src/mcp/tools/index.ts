/**
 * The tool table (ADR 0009 decisions 3 to 7): every command as a tool, plus
 * task_status and task_cancel over the task table. The registry composes
 * these with the resources and the prompt.
 */
import type { ServerPaths, ToolDefinition } from '../types.ts';
import { createCommandTool } from './command-tool.ts';
import type { ToolSpec } from './definitions.ts';
import { finishToolSpecs } from './finish-tools.ts';
import { mediaToolSpecs } from './media-tools.ts';
import { planToolSpecs } from './plan-tools.ts';
import { renderToolSpecs } from './render-tools.ts';
import { taskCancelTool, taskStatusTool } from './task-tools.ts';
import type { TaskTable } from './tasks.ts';
import { WorkLane } from './work-lane.ts';

/** Every command tool's spec, in the order the flow runs them: doctor, validate, plan, still, approve_still, render, assemble, qa, sheet, assets, audio_*. */
export const commandToolSpecs: readonly ToolSpec[] = [...planToolSpecs, ...renderToolSpecs, ...finishToolSpecs, ...mediaToolSpecs];

/** The spec a tool name denotes, or undefined for task_status, task_cancel and unknown names. */
export function findToolSpec(name: string): ToolSpec | undefined {
  return commandToolSpecs.find((spec) => spec.name === name);
}

/**
 * The tools a server serves for the given paths and task table: the command
 * tools (sharing one lane, so the exclusive ones run one at a time whether
 * inline or as tasks) followed by task_status and task_cancel. `paths` is
 * not read at run time (the call's context carries the directories); it is
 * taken so the table is built for one server instance, like the registry.
 */
export function commandTools(_paths: ServerPaths, tasks: TaskTable): readonly ToolDefinition[] {
  const lane = new WorkLane();
  return [...commandToolSpecs.map((spec) => createCommandTool(spec, tasks, lane)), taskStatusTool(tasks), taskCancelTool(tasks)];
}
