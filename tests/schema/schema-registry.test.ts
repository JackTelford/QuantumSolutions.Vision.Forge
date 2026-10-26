import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { SchemaValidationError } from '../../src/errors/vision-forge-error.ts';
import { declaredKind, documentKinds, forEachSubschema, hasSchema, isJsonObject, loadSchemas, schemaFileSuffix, schemaFor, schemasDir } from '../../src/schema/schema-registry.ts';

describe('loadSchemas', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-schemas-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads the committed schemas and keys them by file name', () => {
    assert.deepEqual([...loadSchemas(schemasDir).keys()], [...documentKinds]);
  });

  it('refuses a schema file whose kind constant disagrees with its file name, naming both', () => {
    const path = join(dir, `foo${schemaFileSuffix}`);
    writeFileSync(path, JSON.stringify({ type: 'object', properties: { kind: { const: 'bar' } } }), 'utf8');
    assert.throws(() => loadSchemas(dir), (error: unknown) => error instanceof Error && error.message.includes(path) && /declares kind "bar" but its file name says "foo"/.test(error.message));
    rmSync(path);
  });

  it('refuses a schema file that is not a JSON object', () => {
    const path = join(dir, `list${schemaFileSuffix}`);
    writeFileSync(path, '[]\n', 'utf8');
    assert.throws(() => loadSchemas(dir), (error: unknown) => error instanceof Error && error.message === `${path} is not a JSON object.`);
    rmSync(path);
  });
});

describe('schema-registry', () => {
  it('lists every schema file as a document kind, in file-name order', () => {
    const expected = readdirSync(schemasDir).filter((name) => name.endsWith(schemaFileSuffix)).map((name) => name.slice(0, -schemaFileSuffix.length)).sort();
    assert.deepEqual([...documentKinds], expected);
    assert.deepEqual([...documentKinds], ['cli-result', 'render-manifest', 'tools']);
  });

  it('returns the schema whose kind constant matches the requested kind', () => {
    for (const kind of documentKinds) {
      const schema = schemaFor(kind);
      assert.equal(declaredKind(schema), kind);
      assert.equal(schema['$id'], `https://vision-forge.quantumsolutions.dev/schemas/${kind}${schemaFileSuffix}`);
      assert.equal(hasSchema(kind), true);
    }
  });

  it('throws SchemaValidationError with kind "unknown" and a hint naming the kinds for a kind without a schema', () => {
    assert.equal(hasSchema('scene'), false);
    assert.throws(() => schemaFor('scene'), (error: unknown) => error instanceof SchemaValidationError
      && error.kind === 'unknown'
      && error.problems[0] === '/kind: "scene" is not a known document kind (known kinds: cli-result, render-manifest, tools)'
      && error.hint === 'Set "kind" to one of: cli-result, render-manifest, tools.');
  });

  it('declaredKind reads the kind constant and tolerates schemas without one', () => {
    assert.equal(declaredKind({ properties: { kind: { const: 'x' } } }), 'x');
    assert.equal(declaredKind({ properties: { kind: { type: 'string' } } }), undefined);
    assert.equal(declaredKind({}), undefined);
  });

  it('isJsonObject accepts objects and rejects null, arrays and scalars', () => {
    assert.equal(isJsonObject({}), true);
    assert.equal(isJsonObject(null), false);
    assert.equal(isJsonObject([]), false);
    assert.equal(isJsonObject('{}'), false);
  });

  it('forEachSubschema visits properties, definitions, items and combinators with JSON pointers, in document order', () => {
    const visited: string[] = [];
    forEachSubschema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'array', items: { $ref: '#/$defs/D' } } },
      $defs: { D: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: { type: 'number' } }] } },
      not: { const: 1 },
    }, (_node, pointer) => { visited.push(pointer); });
    assert.deepEqual(visited, ['#', '#/properties/a', '#/properties/b', '#/properties/b/items', '#/$defs/D', '#/$defs/D/anyOf/0', '#/$defs/D/anyOf/1', '#/$defs/D/anyOf/1/additionalProperties', '#/not']);
  });

  it('forEachSubschema does not mistake a property named like a keyword for a subschema', () => {
    const visited: string[] = [];
    forEachSubschema({ type: 'object', properties: { properties: { type: 'string' }, items: { type: 'string' } } }, (_node, pointer) => { visited.push(pointer); });
    assert.deepEqual(visited, ['#', '#/properties/properties', '#/properties/items']);
  });
});
