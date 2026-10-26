/**
 * Enforces schemas/README.md on every schema file, so a new schema that
 * breaks a rule fails here with the JSON pointer of the offending node.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { documentKinds, forEachSubschema, isJsonObject, schemaFileSuffix, schemaFor, schemasDir } from '../../src/schema/schema-registry.ts';
import type { JsonObject } from '../../src/schema/schema-registry.ts';

const forbiddenKeywords: readonly string[] = ['prefixItems', '$dynamicRef', '$dynamicAnchor', 'patternProperties', 'minItems', 'maxItems', 'definitions', 'nullable', 'tsType'];
const implementedFormats: readonly string[] = ['date-time'];
const pascalCase = /^[A-Z][A-Za-z0-9]*$/;
const enumPointer = /^#\/\$defs\/[A-Z][A-Za-z0-9]*$/;
/** Property names that hold a SHA-256 (README rule 11). */
const hashName = /^(sha256|key|.*Hash)$/;
const sha256Pattern = '^[0-9a-f]{64}$';

/** The property name a pointer such as `#/$defs/Program/properties/sha256` ends in, or undefined for a node that is not a property. */
function propertyName(pointer: string): string | undefined {
  const segments = pointer.split('/');
  return segments.length >= 3 && segments[segments.length - 2] === 'properties' ? segments[segments.length - 1] : undefined;
}

function isObjectSchema(node: JsonObject): boolean {
  const type = node['type'];
  return type === 'object' || (Array.isArray(type) && type.includes('object'));
}

function definitionNames(schema: JsonObject): readonly string[] {
  const defs = schema['$defs'];
  return isJsonObject(defs) ? Object.keys(defs) : [];
}

describe('schemas follow the style guide', () => {
  for (const kind of documentKinds) {
    const schema = schemaFor(kind);
    const file = `schemas/${kind}${schemaFileSuffix}`;

    describe(file, () => {
      it('declares draft 2020-12 first and the conventional $id', () => {
        assert.equal(Object.keys(schema)[0], '$schema');
        assert.equal(schema['$schema'], 'https://json-schema.org/draft/2020-12/schema');
        assert.equal(schema['$id'], `https://vision-forge.quantumsolutions.dev/schemas/${kind}${schemaFileSuffix}`);
        assert.match(kind, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      });

      it('has a PascalCase title, a description and is an object', () => {
        assert.match(String(schema['title']), pascalCase);
        assert.equal(typeof schema['description'], 'string');
        assert.equal(schema['type'], 'object');
      });

      it('puts kind and version first, as constants', () => {
        const required = schema['required'];
        assert.ok(Array.isArray(required));
        assert.deepEqual(required.slice(0, 2), ['kind', 'version']);
        const properties = schema['properties'];
        assert.ok(isJsonObject(properties));
        assert.deepEqual(Object.keys(properties).slice(0, 2), ['kind', 'version']);
        assert.deepEqual(properties['kind'], { const: kind, description: `Document kind; always "${kind}".` });
        const version = properties['version'];
        assert.ok(isJsonObject(version));
        assert.equal(version['type'], 'integer');
        assert.ok(Number.isInteger(version['const']));
      });

      it('closes every object, lists required explicitly and only requires declared properties', () => {
        forEachSubschema(schema, (node, pointer) => {
          if (!isObjectSchema(node)) return;
          assert.equal(node['additionalProperties'], false, `${pointer} must set additionalProperties: false`);
          const required = node['required'];
          assert.ok(Array.isArray(required), `${pointer} must list required explicitly`);
          const properties = node['properties'];
          assert.ok(isJsonObject(properties), `${pointer} must declare properties`);
          for (const name of required) assert.ok(typeof name === 'string' && name in properties, `${pointer} requires undeclared property ${String(name)}`);
        });
      });

      it('describes every subschema except bare $refs, which point at local definitions, and names only the root', () => {
        const names = definitionNames(schema);
        forEachSubschema(schema, (node, pointer) => {
          if (pointer !== '#') assert.ok(!('title' in node), `${pointer} must not set title; only the root is named by title`);
          if ('$ref' in node) {
            assert.deepEqual(Object.keys(node), ['$ref'], `${pointer} must be a bare $ref`);
            const target = String(node['$ref']);
            assert.ok(target.startsWith('#/$defs/') && names.includes(target.slice('#/$defs/'.length)), `${pointer} must reference a local definition, got ${target}`);
            return;
          }
          const description = node['description'];
          assert.ok(typeof description === 'string' && description.length > 0, `${pointer} needs a description`);
        });
      });

      it('keeps enumerations in PascalCase $defs with a scalar type', () => {
        forEachSubschema(schema, (node, pointer) => {
          if (!('enum' in node)) return;
          assert.match(pointer, enumPointer, `${pointer} holds an enum outside $defs`);
          assert.ok(node['type'] === 'string' || node['type'] === 'integer', `${pointer} enum must be string or integer`);
          assert.ok(Array.isArray(node['enum']) && node['enum'].length > 0);
        });
        for (const name of definitionNames(schema)) assert.match(name, pascalCase);
      });

      it('uses no forbidden keyword and only implemented formats', () => {
        forEachSubschema(schema, (node, pointer) => {
          for (const keyword of forbiddenKeywords) assert.ok(!(keyword in node), `${pointer} uses forbidden keyword ${keyword}`);
          if ('format' in node) assert.ok(implementedFormats.includes(String(node['format'])), `${pointer} uses unimplemented format ${String(node['format'])}`);
          if ('type' in node && Array.isArray(node['type'])) assert.ok(node['type'].length === 2 && node['type'][1] === 'null', `${pointer} type arrays are only [<type>, "null"]`);
          for (const combinator of ['anyOf', 'oneOf']) {
            const branches = node[combinator];
            if (!Array.isArray(branches)) continue;
            for (const branch of branches) assert.ok(!(isJsonObject(branch) && branch['type'] === 'null'), `${pointer} expresses null through ${combinator}; use type [<type>, "null"]`);
          }
        });
      });

      it('gives every hash property the SHA-256 pattern and puts formats on strings only', () => {
        forEachSubschema(schema, (node, pointer) => {
          const name = propertyName(pointer);
          if (name !== undefined && hashName.test(name)) {
            assert.equal(node['type'], 'string', `${pointer} holds a hash and must be a string`);
            assert.equal(node['pattern'], sha256Pattern, `${pointer} holds a hash and must match ${sha256Pattern}`);
          }
          if ('format' in node) assert.equal(node['type'], 'string', `${pointer} puts format on a node that is not a string`);
        });
      });

      it('is stored with two-space indentation, LF line endings and a final newline', () => {
        const text = readFileSync(join(schemasDir, `${kind}${schemaFileSuffix}`), 'utf8');
        assert.ok(!text.includes('\r'), 'CRLF found');
        assert.ok(text.endsWith('}\n'), 'missing final newline');
        text.split('\n').forEach((line, index) => {
          const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
          assert.ok(!indent.includes('\t') && indent.length % 2 === 0, `line ${index + 1} is not indented by a multiple of two spaces`);
        });
        assert.deepEqual(JSON.parse(text), schema);
      });
    });
  }
});
