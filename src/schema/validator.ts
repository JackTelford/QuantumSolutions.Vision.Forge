/**
 * Validates documents against the schemas in schemas/ with Ajv in draft
 * 2020-12 mode: strict, every error reported, and the one format the schemas
 * use (`date-time`) implemented here so no extra package is needed.
 *
 * Problems are formatted as `<instancePath or $>: <message>`, for example
 * `/exitCode: must be equal to one of the allowed values (allowed: 0, 1, 2, 130)`.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import { SchemaValidationError } from '../errors/vision-forge-error.ts';
import { documentKinds, hasSchema, isJsonObject, schemaFor, unknownKindError, unknownKindHint } from './schema-registry.ts';

const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

function group(match: RegExpExecArray, index: number): number {
  return Number(match[index] ?? Number.NaN);
}

/** True for an RFC 3339 date-time such as `2026-10-26T20:00:00.000Z` or `2026-10-26T22:00:00+02:00`, with real calendar values. */
export function isDateTime(text: string): boolean {
  const match = dateTimePattern.exec(text);
  if (match === null) return false;
  const year = group(match, 1);
  const month = group(match, 2);
  const day = group(match, 3);
  // setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999; day 0 of the next month is the last day of this one.
  const probe = new Date(0);
  probe.setUTCFullYear(year, month, 0);
  const daysInMonth = probe.getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return false;
  if (group(match, 4) > 23 || group(match, 5) > 59 || group(match, 6) > 60) return false;
  if (match[7] !== undefined && (group(match, 8) > 23 || group(match, 9) > 59)) return false;
  return true;
}

let validators: ReadonlyMap<string, ValidateFunction> | undefined;

/** Compiles every schema once, on first use. */
function validatorFor(kind: string): ValidateFunction {
  if (validators === undefined) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat('date-time', { type: 'string', validate: isDateTime });
    const compiled = new Map<string, ValidateFunction>();
    for (const known of documentKinds) {
      ajv.addSchema(schemaFor(known), known);
    }
    for (const known of documentKinds) {
      const validate = ajv.getSchema(known);
      if (validate === undefined) throw new Error(`Ajv did not compile the ${known} schema.`);
      compiled.set(known, validate);
    }
    validators = compiled;
  }
  const validate = validators.get(kind);
  if (validate === undefined) throw unknownKindError(kind);
  return validate;
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** One problem line: the instance path (or `$` for the root), the message and, for vocabularies, the allowed values. */
function describeProblem(error: ErrorObject): string {
  const path = error.instancePath.length > 0 ? error.instancePath : '$';
  const message = error.message ?? error.keyword;
  const params: Readonly<Record<string, unknown>> = error.params;
  switch (error.keyword) {
    case 'enum': {
      const allowed = params['allowedValues'];
      return `${path}: ${message} (allowed: ${Array.isArray(allowed) ? allowed.map(formatValue).join(', ') : '?'})`;
    }
    case 'const':
      return `${path}: ${message} ${JSON.stringify(params['allowedValue'])}`;
    case 'additionalProperties':
      return `${path}: ${message} (found "${formatValue(params['additionalProperty'])}")`;
    default:
      return `${path}: ${message}`;
  }
}

/** Validates a document against the schema for its kind; throws SchemaValidationError listing every problem. */
export function validateDocument(kind: string, document: unknown): void {
  const validate = validatorFor(kind);
  if (validate(document) === true) return;
  throw new SchemaValidationError(kind, (validate.errors ?? []).map(describeProblem));
}

/** Reads the `kind` of a document; throws SchemaValidationError('unknown', ...) when it is missing or has no schema. */
export function assertKind(document: unknown): string {
  if (!isJsonObject(document)) {
    throw new SchemaValidationError('unknown', [`$: must be a JSON object with a "kind" property (known kinds: ${documentKinds.join(', ')})`], unknownKindHint());
  }
  const kind = document['kind'];
  if (typeof kind !== 'string') throw unknownKindError(undefined);
  if (!hasSchema(kind)) throw unknownKindError(kind);
  return kind;
}
