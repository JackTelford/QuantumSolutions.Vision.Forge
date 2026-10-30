/**
 * The declarative shape of a command tool (ADR 0009 decision 3): the
 * command it runs, how each camelCase input reaches an option or a
 * positional, the hooks that write inline documents and attach images, and
 * the JSON Schema a client reads. command-tool.ts turns one of these into a
 * ToolDefinition; the group files (plan-tools.ts, render-tools.ts,
 * finish-tools.ts, media-tools.ts) hold the table itself.
 */
import type { CliResult } from '../../cli/result.ts';
import type { ToolAnnotations, ToolCallContext, ToolContent, ToolInputSchema } from '../types.ts';

/** How one input key becomes argv tokens. */
export const OptionKinds = {
  /** `--option <value>` from a string. */
  string: 'string',
  /** `--option <value>` from a number (or a numeric string the command checks). */
  number: 'number',
  /** `--option` when the boolean is true, nothing when false. */
  flag: 'flag',
  /** `--option <absolute path>` after the path policy. */
  path: 'path',
  /** `--option a,b,c` from an array of strings. */
  list: 'list',
  /** A bare argument after the options, after the path policy. */
  positionalPath: 'positional-path',
} as const;

/** One of the values in OptionKinds. */
export type OptionKind = (typeof OptionKinds)[keyof typeof OptionKinds];

/** One input key and the option it maps onto. */
export interface OptionMapping {
  /** The camelCase key in the tool's input. */
  readonly key: string;
  /** The option name without its dashes; ignored for a positional. */
  readonly option: string;
  readonly kind: OptionKind;
}

/** Which input key asks for the work to run as a task; `render` reads `wait` the other way round. */
export interface BackgroundKey {
  readonly key: string;
  /** True when the key means "do not run in the background" (`wait`). */
  readonly inverted: boolean;
}

/** Rewrites the input before the argv is built: inline documents become files under the output directory. */
export type PrepareHook = (input: Readonly<Record<string, unknown>>, context: ToolCallContext) => Promise<Record<string, unknown>>;

/** Adds content beside the JSON result: the still or the contact sheet as an image. */
export type AttachHook = (result: CliResult, context: ToolCallContext) => Promise<readonly ToolContent[]>;

/** Everything command-tool.ts needs to serve one command as a tool. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** The argv the options follow: `['doctor']`, `['still', '--approve']`, `['audio', 'synth']`. */
  readonly command: readonly string[];
  readonly options: readonly OptionMapping[];
  readonly inputSchema: ToolInputSchema;
  readonly annotations: ToolAnnotations;
  /** True for a tool that renders or encodes: such runs are serialized, in the foreground and as tasks alike. */
  readonly exclusive: boolean;
  /** Input keys that no mapping lists because the prepare hook consumes them (inline documents). */
  readonly inlineKeys?: readonly string[];
  /** Absent: the `background` key. */
  readonly background?: BackgroundKey;
  readonly prepare?: PrepareHook;
  readonly attach?: AttachHook;
}

/** The key every tool but render reads to run as a task. */
export const defaultBackgroundKey: BackgroundKey = { key: 'background', inverted: false };

/** The suffix every path property's description carries, so the model knows the policy before it is refused. */
export const pathPolicyNote = 'Absolute, or relative to the output directory; it must lie under the output, data, repository or home directory.';

/** A JSON Schema string property, with the allowed values when the option has a fixed vocabulary. */
export function stringProperty(description: string, enumValues?: readonly string[]): Record<string, unknown> {
  return enumValues === undefined ? { type: 'string', description } : { type: 'string', description, enum: [...enumValues] };
}

/** A JSON Schema number property. */
export function numberProperty(description: string): Record<string, unknown> {
  return { type: 'number', description };
}

/** A JSON Schema boolean property. */
export function booleanProperty(description: string): Record<string, unknown> {
  return { type: 'boolean', description };
}

/** A JSON Schema string property for a file or folder, with the path policy appended. */
export function pathProperty(description: string): Record<string, unknown> {
  return { type: 'string', description: `${description} ${pathPolicyNote}` };
}

/** A JSON Schema array-of-strings property. */
export function listProperty(description: string): Record<string, unknown> {
  return { type: 'array', items: { type: 'string' }, description };
}

/** A JSON Schema object property for an inline document. */
export function objectProperty(description: string): Record<string, unknown> {
  return { type: 'object', description };
}

/** The `background` property every tool but render carries. */
export const backgroundProperty: Record<string, unknown> = booleanProperty('When true, start the work as a task and return its id at once; task_status gives the progress lines and, when it ends, the result. Default false: run inline and return the result.');

/** An input schema over the given properties plus `background`, with the required keys named. */
export function inputSchema(properties: Readonly<Record<string, unknown>>, required: readonly string[] = []): ToolInputSchema {
  return { type: 'object', properties: { ...properties, background: backgroundProperty }, ...(required.length > 0 ? { required: [...required] } : {}), additionalProperties: false };
}

/** An input schema over the given properties only, for a tool that names its own task key (render's `wait`). */
export function plainInputSchema(properties: Readonly<Record<string, unknown>>, required: readonly string[] = []): ToolInputSchema {
  return { type: 'object', properties: { ...properties }, ...(required.length > 0 ? { required: [...required] } : {}), additionalProperties: false };
}

/** Annotations for a tool that only reads and reports. */
export const readOnlyAnnotations: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

/** Annotations for a tool that writes under the output or data directory and talks to nothing outside the machine. */
export const localWriteAnnotations: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

/** Annotations for a tool that downloads from the allowlisted hosts. */
export const downloadAnnotations: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
