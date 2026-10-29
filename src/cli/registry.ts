/**
 * The command table. Names are fixed here; implementations are loaded on
 * demand so that `help` does not import every lane.
 */
import type { Command } from './command.ts';

/** Every command the skill may call, with the milestone that delivers it. */
export const CommandPlan = {
  help: 'M0b',
  version: 'M0b',
  doctor: 'M1',
  validate: 'M1',
  plan: 'M2',
  still: 'M3',
  render: 'M3',
  sheet: 'M3',
  assemble: 'M1',
  qa: 'M1',
  audio: 'M6',
  assets: 'M3',
} as const;

/** A command name. */
export type CommandName = keyof typeof CommandPlan;

/** All command names in display order. */
export const commandNames: readonly CommandName[] = Object.keys(CommandPlan) as CommandName[];

/** True when the string names a command. */
export function isCommandName(value: string): value is CommandName {
  return Object.hasOwn(CommandPlan, value);
}

const loaders: Readonly<Partial<Record<CommandName, () => Promise<{ readonly command: Command }>>>> = {
  help: () => import('./commands/help.ts'),
  version: () => import('./commands/version.ts'),
  doctor: () => import('./commands/doctor.ts'),
  validate: () => import('./commands/validate.ts'),
  plan: () => import('./commands/plan.ts'),
  assemble: () => import('./commands/assemble.ts'),
  qa: () => import('./commands/qa.ts'),
  sheet: () => import('./commands/sheet.ts'),
  still: () => import('./commands/still.ts'),
  render: () => import('./commands/render.ts'),
  assets: () => import('./commands/assets.ts'),
  audio: () => import('./commands/audio.ts'),
};

/** Loads a command's implementation, or undefined when it is not implemented yet. */
export async function loadCommand(name: CommandName): Promise<Command | undefined> {
  const loader = loaders[name];
  if (loader === undefined) return undefined;
  const module = await loader();
  return module.command;
}
