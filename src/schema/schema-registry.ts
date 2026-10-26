/**
 * Every JSON Schema under schemas/, loaded once at startup and looked up by
 * document kind. The file name is the kind: schemas/<kind>.schema.json, and
 * the schema's own `kind` constant must agree with it.
 *
 * Also the one place that knows how to walk a schema's subschemas, which the
 * type generator and the style-guide test both need.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SchemaValidationError } from '../errors/vision-forge-error.ts';
import { readJsonFile } from '../fs/atomic-json.ts';

/** A parsed JSON object, as a schema or any of its subschemas is. */
export type JsonObject = { readonly [key: string]: unknown };

/** True when the value is a JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Absolute path of the schemas directory; the repository root is two levels up from src/schema/. */
export const schemasDir: string = resolve(import.meta.dirname, '..', '..', 'schemas');

/** Suffix every schema file name ends with. */
export const schemaFileSuffix = '.schema.json';

/** The `kind` constant a schema declares in its properties, or undefined when it has none. */
export function declaredKind(schema: JsonObject): string | undefined {
  const properties = schema['properties'];
  if (!isJsonObject(properties)) return undefined;
  const kind = properties['kind'];
  if (!isJsonObject(kind)) return undefined;
  const value = kind['const'];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads every `<kind>.schema.json` in the directory, keyed by kind in
 * file-name order. Refuses a file that is not a JSON object and a file whose
 * `kind` constant disagrees with its name, so a misnamed schema fails at
 * startup instead of validating the wrong documents.
 */
export function loadSchemas(dir: string): ReadonlyMap<string, JsonObject> {
  const loaded = new Map<string, JsonObject>();
  const files = readdirSync(dir).filter((name) => name.endsWith(schemaFileSuffix)).sort();
  for (const file of files) {
    const kind = file.slice(0, -schemaFileSuffix.length);
    const path = join(dir, file);
    const schema = readJsonFile(path);
    if (!isJsonObject(schema)) throw new Error(`${path} is not a JSON object.`);
    const declared = declaredKind(schema);
    if (declared !== kind) throw new Error(`${path} declares kind "${declared ?? '(none)'}" but its file name says "${kind}".`);
    loaded.set(kind, schema);
  }
  return loaded;
}

const schemas: ReadonlyMap<string, JsonObject> = loadSchemas(schemasDir);

/** The document kinds that have a schema, in file-name order. */
export const documentKinds: readonly string[] = [...schemas.keys()];

/** True when a schema exists for the kind. */
export function hasSchema(kind: string): boolean {
  return schemas.has(kind);
}

/** The hint every unknown-kind error carries: there is no schemas/unknown.schema.json to point at, so it names the kinds instead. */
export function unknownKindHint(): string {
  return `Set "kind" to one of: ${documentKinds.join(', ')}.`;
}

/** The error thrown for a document whose kind has no schema. */
export function unknownKindError(kind: string | undefined): SchemaValidationError {
  const problem = kind === undefined
    ? '/kind: must be a string naming the document kind'
    : `/kind: "${kind}" is not a known document kind`;
  return new SchemaValidationError('unknown', [`${problem} (known kinds: ${documentKinds.join(', ')})`], unknownKindHint());
}

/** The schema for a document kind. Throws SchemaValidationError for a kind without a schema. */
export function schemaFor(kind: string): JsonObject {
  const schema = schemas.get(kind);
  if (schema === undefined) throw unknownKindError(kind);
  return schema;
}

/** Keywords whose value maps names to subschemas. */
const schemaMapKeywords: readonly string[] = ['properties', '$defs', 'patternProperties', 'dependentSchemas'];
/** Keywords whose value is a list of subschemas. */
const schemaListKeywords: readonly string[] = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
/** Keywords whose value is a single subschema. */
const schemaKeywords: readonly string[] = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems'];

/**
 * Visits a schema and every subschema under it, depth first, in document
 * order. The pointer is a JSON pointer from the root, for example
 * `#/properties/gpu` or `#/$defs/Browser/properties/channel`.
 */
export function forEachSubschema(schema: JsonObject, visit: (node: JsonObject, pointer: string) => void, pointer = '#'): void {
  visit(schema, pointer);
  for (const keyword of schemaMapKeywords) {
    const map = schema[keyword];
    if (!isJsonObject(map)) continue;
    for (const [name, child] of Object.entries(map)) {
      if (isJsonObject(child)) forEachSubschema(child, visit, `${pointer}/${keyword}/${name}`);
    }
  }
  for (const keyword of schemaListKeywords) {
    const list = schema[keyword];
    if (!Array.isArray(list)) continue;
    list.forEach((child: unknown, index: number) => {
      if (isJsonObject(child)) forEachSubschema(child, visit, `${pointer}/${keyword}/${index}`);
    });
  }
  for (const keyword of schemaKeywords) {
    const child = schema[keyword];
    if (isJsonObject(child)) forEachSubschema(child, visit, `${pointer}/${keyword}`);
  }
}
