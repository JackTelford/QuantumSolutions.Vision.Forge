/**
 * Typed readers over a tool's input record. A client sends JSON, so every
 * value arrives as unknown; each reader returns the value when it has the
 * type the schema promised and throws a UsageError naming the key when it
 * does not, which the bridge turns into a failure result like any other
 * usage error.
 */
import { UsageError } from '../../errors/vision-forge-error.ts';

/** A plain object from the wire, or undefined when the key is absent. */
export function readRecord(input: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UsageError(`"${key}" must be an object, got ${describe(value)}.`, `Pass "${key}" as a JSON object.`);
  return value as Record<string, unknown>;
}

/** A string, or undefined when the key is absent. */
export function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new UsageError(`"${key}" must be a string, got ${describe(value)}.`, `Pass "${key}" as a JSON string.`);
  return value;
}

/** A number, or a string the command will check as a number, or undefined when the key is absent. */
export function readNumber(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new UsageError(`"${key}" must be a finite number.`, `Pass "${key}" as a JSON number.`);
    return String(value);
  }
  if (typeof value === 'string') return value;
  throw new UsageError(`"${key}" must be a number, got ${describe(value)}.`, `Pass "${key}" as a JSON number.`);
}

/** A boolean, or undefined when the key is absent. */
export function readBoolean(input: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new UsageError(`"${key}" must be true or false, got ${describe(value)}.`, `Pass "${key}" as a JSON boolean.`);
  return value;
}

/** An array of strings, or undefined when the key is absent. */
export function readStringList(input: Readonly<Record<string, unknown>>, key: string): readonly string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new UsageError(`"${key}" must be an array of strings, got ${describe(value)}.`, `Pass "${key}" as a JSON array of strings.`);
  return value as string[];
}

/** Throws a UsageError naming the first key the tool does not know, with the keys it does. */
export function assertKnownKeys(input: Readonly<Record<string, unknown>>, allowed: readonly string[], toolName: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new UsageError(`Unknown input "${key}" for ${toolName}.`, `${toolName} takes: ${allowed.join(', ')}.`);
  }
}

/** A short description of a value's type for an error message. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}
