/**
 * The bridge from a tool call to a command (ADR 0009 decision 3): the
 * camelCase input becomes the argv its spec maps it to, every path passes
 * the path policy, the command runs in-process through runCommand with the
 * server's directories and a logger that reports to the client, and the
 * result document comes back as the tool result. `background: true` (or
 * render without `wait`) starts the same run as a task instead. The
 * pre-flight (the prepare hook, the key check, the argv and the path
 * policy) always runs in the call itself, so a usage error answers the call
 * whether or not the work then goes to a task.
 */
import type { Logger } from '../../cli/logger.ts';
import { runCommand } from '../../cli/run.ts';
import type { CliResult } from '../../cli/result.ts';
import { CancelledError } from '../../errors/vision-forge-error.ts';
import type { ServerPaths, ToolCallContext, ToolContent, ToolDefinition, ToolResult } from '../types.ts';
import { OptionKinds, defaultBackgroundKey } from './definitions.ts';
import type { OptionMapping, ToolSpec } from './definitions.ts';
import { assertKnownKeys, readBoolean, readNumber, readString, readStringList } from './inputs.ts';
import { resolveAllowedPath } from './path-policy.ts';
import { failureResultOf, failureToolResult, taskStartedResult, toolResultOf } from './results.ts';
import type { TaskTable } from './tasks.ts';
import type { WorkLane } from './work-lane.ts';

/** The input keys a spec accepts: its mappings, its inline keys and its background key. */
export function acceptedKeys(spec: ToolSpec): readonly string[] {
  return [...spec.options.map((mapping) => mapping.key), ...(spec.inlineKeys ?? []), (spec.background ?? defaultBackgroundKey).key];
}

/** True when the input asks for a task: `background: true`, or `wait` absent or false on render. */
export function isBackground(spec: ToolSpec, input: Readonly<Record<string, unknown>>): boolean {
  const key = spec.background ?? defaultBackgroundKey;
  const value = readBoolean(input, key.key) ?? false;
  return key.inverted ? !value : value;
}

/** The argv the spec builds from the input: the command, then every mapped option in spec order, then the positionals. Paths pass the policy here. */
export function buildArgv(spec: ToolSpec, input: Readonly<Record<string, unknown>>, paths: ServerPaths): readonly string[] {
  assertKnownKeys(input, acceptedKeys(spec), spec.name);
  const options: string[] = [];
  const positionals: string[] = [];
  for (const mapping of spec.options) {
    const tokens = tokensOf(mapping, input, paths);
    if (mapping.kind === OptionKinds.positionalPath) positionals.push(...tokens);
    else options.push(...tokens);
  }
  return [...spec.command, ...options, ...positionals];
}

function tokensOf(mapping: OptionMapping, input: Readonly<Record<string, unknown>>, paths: ServerPaths): readonly string[] {
  const flag = `--${mapping.option}`;
  switch (mapping.kind) {
    case OptionKinds.string: {
      const value = readString(input, mapping.key);
      return value === undefined ? [] : [flag, value];
    }
    case OptionKinds.number: {
      const value = readNumber(input, mapping.key);
      return value === undefined ? [] : [flag, value];
    }
    case OptionKinds.flag:
      return readBoolean(input, mapping.key) === true ? [flag] : [];
    case OptionKinds.path: {
      const value = readString(input, mapping.key);
      return value === undefined ? [] : [flag, resolveAllowedPath(value, paths, `"${mapping.key}"`)];
    }
    case OptionKinds.list: {
      const value = readStringList(input, mapping.key);
      return value === undefined ? [] : [flag, value.join(',')];
    }
    case OptionKinds.positionalPath: {
      const value = readString(input, mapping.key);
      return value === undefined ? [] : [resolveAllowedPath(value, paths, `"${mapping.key}"`)];
    }
    default:
      return [];
  }
}

/** A logger whose every line goes to the client through the call's report function. */
export function reportLogger(report: (message: string) => void): Logger {
  return {
    info(message: string): void { report(message); },
    warn(message: string): void { report(`warning: ${message}`); },
    debug(message: string): void { report(`debug: ${message}`); },
  };
}

/** The pre-flight: the prepare hook (inline documents become files), then the argv with every path through the policy. Throws the usage error a bad input raises. */
export async function prepareArgv(spec: ToolSpec, input: Readonly<Record<string, unknown>>, context: ToolCallContext): Promise<readonly string[]> {
  const paths: ServerPaths = { dataDir: context.dataDir, outDir: context.outDir, repositoryRoot: context.repositoryRoot };
  const prepared = spec.prepare === undefined ? input : await spec.prepare(input, context);
  return buildArgv(spec, prepared, paths);
}

/**
 * Runs a prepared argv for the spec and returns the tool result; nothing
 * here throws. An exclusive spec queues on the lane; a call cancelled while
 * it waits never enters the command and answers with code cancelled.
 */
export async function runPrepared(spec: ToolSpec, argv: readonly string[], context: ToolCallContext, lane: WorkLane): Promise<ToolResult> {
  const commandName = spec.command[0] ?? spec.name;
  const work = (): Promise<CliResult> => {
    if (context.signal.aborted) return Promise.resolve(failureResultOf(commandName, new CancelledError()));
    return runCommand(argv, { signal: context.signal, log: reportLogger(context.report), dataDir: context.dataDir, outDir: context.outDir, cwd: context.outDir });
  };
  let result: CliResult;
  if (spec.exclusive && !context.signal.aborted) {
    if (lane.isBusy()) context.report(`${spec.name}: waiting for the render lane, which another tool holds`);
    result = await lane.run(work);
  } else {
    result = await work();
  }
  let attached: readonly ToolContent[] = [];
  if (spec.attach !== undefined) {
    try {
      attached = await spec.attach(result, context);
    } catch (error: unknown) {
      attached = [{ type: 'text', text: `The image could not be attached: ${error instanceof Error ? error.message : String(error)}.` }];
    }
  }
  return toolResultOf(result, attached);
}

/** Runs the spec's command inline for the input and returns the tool result; nothing here throws. */
export async function executeSpec(spec: ToolSpec, input: Readonly<Record<string, unknown>>, context: ToolCallContext, lane: WorkLane): Promise<ToolResult> {
  let argv: readonly string[];
  try {
    argv = await prepareArgv(spec, input, context);
  } catch (error: unknown) {
    return failureToolResult(spec.command[0] ?? spec.name, error);
  }
  return runPrepared(spec, argv, context, lane);
}

/** The tool a spec defines: inline by default, a task when the input asks for one; the pre-flight answers the call either way. */
export function createCommandTool(spec: ToolSpec, tasks: TaskTable, lane: WorkLane): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: spec.annotations,
    exclusive: spec.exclusive,
    async run(input: Record<string, unknown>, context: ToolCallContext): Promise<ToolResult> {
      let background: boolean;
      let argv: readonly string[];
      try {
        background = isBackground(spec, input);
        argv = await prepareArgv(spec, input, context);
      } catch (error: unknown) {
        return failureToolResult(spec.command[0] ?? spec.name, error);
      }
      if (!background) return runPrepared(spec, argv, context, lane);
      const started = tasks.start(spec.name, (signal, report) => runPrepared(spec, argv, { ...context, signal, report }, lane));
      return taskStartedResult(started.taskId, spec.name, started.startedAt);
    },
  };
}
