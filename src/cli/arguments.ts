/**
 * A small, explicit command-line parser. Every command declares which string
 * options and which flags it accepts; anything else is a usage error with
 * the exact unknown token in the message.
 *
 * Accepted forms: `--name value`, `--name=value`, `--flag`. Positional
 * arguments are everything that does not start with `--`.
 */
import { UsageError } from '../errors/vision-forge-error.ts';

/** The options a command accepts. */
export interface ArgumentSpec {
  readonly strings: readonly string[];
  readonly flags: readonly string[];
}

/** Parsed arguments with typed accessors. */
export class ParsedArguments {
  readonly positionals: readonly string[];
  private readonly values: ReadonlyMap<string, string>;
  private readonly flags: ReadonlySet<string>;

  constructor(positionals: readonly string[], values: ReadonlyMap<string, string>, flags: ReadonlySet<string>) {
    this.positionals = positionals;
    this.values = values;
    this.flags = flags;
  }

  /** The value of a string option, or undefined when absent. */
  string(name: string): string | undefined {
    return this.values.get(name);
  }

  /** The value of a string option; a usage error names the option when it is absent. */
  requireString(name: string, purpose: string): string {
    const value = this.values.get(name);
    if (value === undefined) throw new UsageError(`Missing --${name}.`, `Pass --${name} <value>: ${purpose}.`);
    return value;
  }

  /** The numeric value of a string option; a usage error when present but not a finite number. */
  number(name: string): number | undefined {
    const value = this.values.get(name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new UsageError(`--${name} must be a number, got "${value}".`, `Pass --${name} <number>.`);
    return parsed;
  }

  /** True when a flag was given. */
  flag(name: string): boolean {
    return this.flags.has(name);
  }
}

/** Parses argv against a spec. Unknown options and missing values are usage errors. */
export function parseArguments(argv: readonly string[], spec: ArgumentSpec): ParsedArguments {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const equals = body.indexOf('=');
    const name = equals >= 0 ? body.slice(0, equals) : body;
    if (spec.flags.includes(name)) {
      if (equals >= 0) throw new UsageError(`--${name} is a flag and takes no value.`, `Pass --${name} on its own.`);
      flags.add(name);
      continue;
    }
    if (spec.strings.includes(name)) {
      if (equals >= 0) {
        values.set(name, body.slice(equals + 1));
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`--${name} needs a value.`, `Pass --${name} <value> or --${name}=<value>.`);
      values.set(name, next);
      index += 1;
      continue;
    }
    throw new UsageError(`Unknown option --${name}.`, `Allowed options: ${[...spec.strings.map((s) => `--${s} <value>`), ...spec.flags.map((f) => `--${f}`)].join(', ') || 'none'}.`);
  }
  return new ParsedArguments(positionals, values, flags);
}

/** Combines two specs, for global options plus a command's own. */
export function mergeSpecs(first: ArgumentSpec, second: ArgumentSpec): ArgumentSpec {
  return { strings: [...first.strings, ...second.strings], flags: [...first.flags, ...second.flags] };
}
