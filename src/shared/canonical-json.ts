/**
 * Canonical JSON: the one serialization of a value that every hash is taken
 * over. Object keys are sorted, there is no whitespace, and values that JSON
 * cannot represent (NaN, Infinity, functions, bigint) are rejected instead of
 * being silently turned into null. Runs in Node and in the browser.
 */

/** Any value JSON can represent. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Serializes a value canonically: sorted keys, no whitespace, no lossy conversions. */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Cannot canonicalize a non-finite number at ${path}.`);
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`Cannot canonicalize a value of type ${typeof value} at ${path}.`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown, index: number) => serialize(item === undefined ? null : item, `${path}[${index}]`)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`)}`).join(',')}}`;
}
