/**
 * Generates src/shared/contracts/<kind>.ts from every schemas/<kind>.schema.json
 * with json-schema-to-typescript, and checks the committed files for drift.
 *
 *   node scripts/gen-types.ts          writes the contract files
 *   node scripts/gen-types.ts --check  exits 1 and lists the stale files when
 *                                      the committed files differ (the CI check)
 *
 * The output is byte-deterministic: the same schemas always produce the same
 * bytes, with LF line endings, so the files can be committed and compared.
 * Each file holds the generated interfaces followed by one `<Name>Values`
 * array per named enumeration in `$defs`, so runtime code can list a
 * vocabulary without parsing the schema.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { compile } from 'json-schema-to-typescript';
import { documentKinds, forEachSubschema, isJsonObject, schemaFileSuffix, schemaFor } from '../src/schema/schema-registry.ts';
import type { JsonObject } from '../src/schema/schema-registry.ts';

/** Absolute path of the repository root (one level above scripts/). */
export const repoRoot: string = resolve(import.meta.dirname, '..');

/** Where the generated contract files live. */
export const contractsDir: string = join(repoRoot, 'src', 'shared', 'contracts');

type CompileOptions = NonNullable<Parameters<typeof compile>[2]>;

const compileOptions: CompileOptions = {
  // The $ref resolver may not fetch: a non-local $ref fails here instead of reaching the network (AGENTS.md).
  $refOptions: { resolve: { http: false } },
  bannerComment: '',
  additionalProperties: false,
  strictIndexSignatures: true,
  style: { singleQuote: true, semi: true, printWidth: 120 },
  unreachableDefinitions: true,
  unknownAny: true,
};

/** Why a committed contract file is not current. */
export const StaleReasons = {
  missing: 'missing',
  differs: 'differs',
  orphan: 'orphan',
} as const;

/** One of the values in StaleReasons. */
export type StaleReason = (typeof StaleReasons)[keyof typeof StaleReasons];

/** A contract file that --check would reject. */
export interface StaleContract {
  /** File name under src/shared/contracts/, for example `tools.ts`. */
  readonly file: string;
  readonly reason: StaleReason;
}

/**
 * A copy of the schema prepared for json-schema-to-typescript: a subschema
 * that is only a description (the "any JSON value" idiom from
 * schemas/README.md) is marked `tsType: 'unknown'`, which the generator maps
 * to `unknown` instead of an indexed object. The schema on disk stays plain
 * JSON Schema; the mark exists only in memory.
 */
function prepareForCompile(schema: JsonObject): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(schema);
  forEachSubschema(copy, (node: JsonObject) => {
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === 'description') {
      const mutable: Record<string, unknown> = node;
      mutable['tsType'] = 'unknown';
    }
  });
  return copy;
}

function literal(value: unknown): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return JSON.stringify(value);
}

/** The `export const <Name>Values = [...] as const;` block for every enumeration in `$defs`, in schema order. */
export function enumValueArrays(schema: JsonObject): string {
  const defs = schema['$defs'];
  if (!isJsonObject(defs)) return '';
  const blocks: string[] = [];
  for (const [name, definition] of Object.entries(defs)) {
    if (!isJsonObject(definition)) continue;
    const values = definition['enum'];
    if (!Array.isArray(values)) continue;
    blocks.push(`/** Every ${name} value the schema allows, in schema order. */\nexport const ${name}Values = [${values.map(literal).join(', ')}] as const;\n`);
  }
  return blocks.length === 0 ? '' : `\n${blocks.join('\n')}`;
}

/**
 * The TypeScript source of the contract file for a schema. The schema must
 * carry a `title`: the generator names the root type after it (and ignores
 * the name argument when `$id` is present), so a missing title would produce
 * a root type named after the URL, and a non-local `$ref` is refused.
 */
export async function compileContract(kind: string, schema: JsonObject): Promise<string> {
  const title = schema['title'];
  if (typeof title !== 'string') throw new Error(`schemas/${kind}${schemaFileSuffix} has no title; the generated root type is named after it.`);
  const generated = await compile(prepareForCompile(schema) as Parameters<typeof compile>[0], title, compileOptions);
  const header = `/** @generated from schemas/${kind}${schemaFileSuffix} by scripts/gen-types.ts. Do not edit. */`;
  return `${header}\n\n${generated.replace(/\r\n/g, '\n').trim()}\n${enumValueArrays(schema)}`;
}

/** The TypeScript source of one kind's contract file. */
export async function generateContract(kind: string): Promise<string> {
  return compileContract(kind, schemaFor(kind));
}

/** Every contract file, keyed by file name (`<kind>.ts`), in kind order. */
export async function generateContracts(): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  for (const kind of documentKinds) {
    files.set(`${kind}.ts`, await generateContract(kind));
  }
  return files;
}

/** Writes every generated file into the directory, creating it when needed. */
export function writeContracts(generated: ReadonlyMap<string, string>, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of generated) {
    writeFileSync(join(dir, file), text, 'utf8');
  }
}

/** The files in the directory that are missing, differ from the generated text, or have no schema. Empty when everything is current. */
export function findStaleContracts(generated: ReadonlyMap<string, string>, dir: string): readonly StaleContract[] {
  const stale: StaleContract[] = [];
  for (const [file, text] of generated) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      stale.push({ file, reason: StaleReasons.missing });
    } else if (readFileSync(path, 'utf8') !== text) {
      stale.push({ file, reason: StaleReasons.differs });
    }
  }
  const present = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.ts')).sort() : [];
  for (const file of present) {
    if (!generated.has(file)) stale.push({ file, reason: StaleReasons.orphan });
  }
  return stale;
}

function displayPath(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, '/');
}

/**
 * The lines --check prints for stale contract files: one `stale:` line per
 * file, then what to do. Regenerating fixes a missing or differing file; an
 * orphan has no schema and regenerating never removes it, so it must be deleted.
 */
export function describeStale(stale: readonly StaleContract[], dir: string): readonly string[] {
  const lines: string[] = [];
  for (const entry of stale) {
    const schemaFile = `schemas/${entry.file.slice(0, -'.ts'.length)}${schemaFileSuffix}`;
    const detail = entry.reason === StaleReasons.orphan
      ? `has no ${schemaFile}`
      : `${entry.reason === StaleReasons.missing ? 'is missing for' : 'differs from'} ${schemaFile}`;
    lines.push(`stale: ${displayPath(join(dir, entry.file))} ${detail}`);
  }
  if (stale.some((entry) => entry.reason !== StaleReasons.orphan)) lines.push('Run "npm run schema:gen" and commit the result.');
  for (const entry of stale) {
    if (entry.reason === StaleReasons.orphan) lines.push(`Delete ${displayPath(join(dir, entry.file))}; it has no schema.`);
  }
  return lines;
}

async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check');
  const unknown = argv.filter((token) => token !== '--check');
  if (unknown.length > 0) {
    process.stderr.write(`Unknown argument ${unknown.join(' ')}. Usage: node scripts/gen-types.ts [--check]\n`);
    return 2;
  }
  const generated = await generateContracts();
  if (!check) {
    writeContracts(generated, contractsDir);
    for (const file of generated.keys()) process.stdout.write(`wrote ${displayPath(join(contractsDir, file))}\n`);
    return 0;
  }
  const stale = findStaleContracts(generated, contractsDir);
  if (stale.length === 0) {
    process.stdout.write(`${generated.size} contract files are up to date.\n`);
    return 0;
  }
  for (const line of describeStale(stale, contractsDir)) process.stdout.write(`${line}\n`);
  return 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
