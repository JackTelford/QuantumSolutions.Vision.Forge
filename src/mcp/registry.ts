/**
 * Composes what the server serves (ADR 0009): the command tools and the task
 * tools over one task table, the knowledge-base resources and the directing
 * prompt, bound to one set of paths. scripts/mcp.ts calls this once; the
 * tests build registries of their own.
 */
import { serverInstructions, studioPrompts } from './prompts.ts';
import { knowledgeResources } from './resources.ts';
import { commandTools } from './tools/index.ts';
import { TaskTable } from './tools/tasks.ts';
import type { ServerPaths, ServerRegistry } from './types.ts';

/** The registry a server instance serves for the given paths: one task table for the session, every tool, resource and prompt. */
export function createRegistry(paths: ServerPaths): ServerRegistry {
  const tasks = new TaskTable();
  return {
    tools: commandTools(paths, tasks),
    resources: knowledgeResources(paths),
    prompts: studioPrompts(paths),
    instructions: serverInstructions(paths),
  };
}
