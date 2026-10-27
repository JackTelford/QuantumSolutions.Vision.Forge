/**
 * Enforces schemas/README.md rule 16: every $defs enumeration whose name is a
 * key of schemas/vocabulary.json repeats that entry exactly, so the same
 * vocabulary cannot drift between two schema files.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readJsonFile } from '../../src/fs/atomic-json.ts';
import { documentKinds, isJsonObject, schemaFor, schemasDir } from '../../src/schema/schema-registry.ts';
import type { JsonObject } from '../../src/schema/schema-registry.ts';
import { TransitionTypeValues as assemblyTransitionTypes } from '../../src/shared/contracts/assembly-plan.ts';
import { FrameRateValues as briefFrameRates } from '../../src/shared/contracts/brief.ts';
import { JobStatusValues, ShotStatusValues } from '../../src/shared/contracts/job.ts';
import { LaneValues as manifestLanes } from '../../src/shared/contracts/render-manifest.ts';
import { CameraMoveValues, LaneValues as shotSpecLanes, TransitionTypeValues as shotSpecTransitionTypes } from '../../src/shared/contracts/shot-spec.ts';

const vocabularyPath = join(schemasDir, 'vocabulary.json');
const pascalCase = /^[A-Z][A-Za-z0-9]*$/;

/**
 * Definitions that share a vocabulary name but mean something else; they
 * would predate the vocabulary and be exempt until their owner renames them.
 * The test below fails once an entry here no longer exists, so the list
 * cannot outlive the collision. Empty today: the one collision (`qa-report`'s
 * subject kind) was renamed `QaSubjectKind`.
 */
const knownCollisions: Readonly<Record<string, readonly string[]>> = {};

interface VocabularyEntry {
  readonly type: 'string' | 'integer';
  readonly values: readonly (string | number)[];
  readonly description: string;
}

function isEntry(value: unknown): value is VocabularyEntry {
  return isJsonObject(value) && (value['type'] === 'string' || value['type'] === 'integer') && Array.isArray(value['values']) && typeof value['description'] === 'string';
}

function loadVocabulary(): ReadonlyMap<string, VocabularyEntry> {
  const raw = readJsonFile(vocabularyPath);
  assert.ok(isJsonObject(raw), 'vocabulary.json must be a JSON object');
  const entries = new Map<string, VocabularyEntry>();
  for (const [name, value] of Object.entries(raw)) {
    assert.ok(isEntry(value), `vocabulary entry ${name} must be { type: string|integer, values: [...], description }`);
    entries.set(name, value);
  }
  return entries;
}

function definitionsOf(kind: string): ReadonlyMap<string, JsonObject> {
  const defs = schemaFor(kind)['$defs'];
  const found = new Map<string, JsonObject>();
  if (!isJsonObject(defs)) return found;
  for (const [name, definition] of Object.entries(defs)) {
    if (isJsonObject(definition)) found.set(name, definition);
  }
  return found;
}

describe('schemas/vocabulary.json', () => {
  const vocabulary = loadVocabulary();

  it('maps PascalCase names to non-empty, duplicate-free value lists of the declared type, each with a description', () => {
    assert.ok(vocabulary.size >= 30);
    for (const [name, entry] of vocabulary) {
      assert.match(name, pascalCase);
      assert.ok(entry.values.length > 0, `${name} has no values`);
      assert.equal(new Set(entry.values).size, entry.values.length, `${name} repeats a value`);
      for (const value of entry.values) {
        if (entry.type === 'integer') assert.ok(Number.isInteger(value), `${name} value ${String(value)} is not an integer`);
        else assert.equal(typeof value, 'string', `${name} value ${String(value)} is not a string`);
      }
      assert.ok(entry.description.length > 0, `${name} needs a description`);
    }
  });

  it('is stored with two-space indentation, LF line endings and a final newline', () => {
    const text = readFileSync(vocabularyPath, 'utf8');
    assert.ok(!text.includes('\r'), 'CRLF found');
    assert.ok(text.endsWith('}\n'), 'missing final newline');
    text.split('\n').forEach((line, index) => {
      const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
      assert.ok(!indent.includes('\t') && indent.length % 2 === 0, `line ${index + 1} is not indented by a multiple of two spaces`);
    });
  });

  for (const kind of documentKinds) {
    it(`every $defs enumeration of ${kind} named like a vocabulary entry equals it: same type, same values, same order`, () => {
      const exempt = knownCollisions[kind] ?? [];
      for (const [name, definition] of definitionsOf(kind)) {
        const entry = vocabulary.get(name);
        if (entry === undefined || exempt.includes(name)) continue;
        assert.equal(definition['type'], entry.type, `schemas/${kind}.schema.json $defs.${name} has type ${String(definition['type'])}, the vocabulary says ${entry.type}`);
        assert.deepEqual(definition['enum'], entry.values, `schemas/${kind}.schema.json $defs.${name} differs from vocabulary.json`);
      }
    });
  }

  it('every vocabulary entry is carried by at least one schema', () => {
    const carried = new Set<string>();
    for (const kind of documentKinds) {
      for (const [name, definition] of definitionsOf(kind)) {
        if ('enum' in definition && !(knownCollisions[kind] ?? []).includes(name)) carried.add(name);
      }
    }
    for (const name of vocabulary.keys()) assert.ok(carried.has(name), `vocabulary entry ${name} is used by no schema; remove it or use it`);
  });

  it('lists only collisions that still exist, so the exemption cannot outlive the rename', () => {
    for (const [kind, names] of Object.entries(knownCollisions)) {
      const definitions = definitionsOf(kind);
      for (const name of names) {
        const definition = definitions.get(name);
        assert.ok(definition !== undefined, `schemas/${kind}.schema.json no longer defines ${name}; drop it from knownCollisions`);
        const entry = vocabulary.get(name);
        assert.ok(entry !== undefined, `vocabulary.json no longer defines ${name}; drop it from knownCollisions`);
        assert.notDeepEqual(definition['enum'], entry.values, `schemas/${kind}.schema.json $defs.${name} now matches the vocabulary; drop it from knownCollisions`);
      }
    }
  });

  it('the generated value arrays carry the vocabulary, so Lane cannot drift between render-manifest and shot-spec', () => {
    assert.deepEqual([...manifestLanes], vocabulary.get('Lane')?.values);
    assert.deepEqual([...shotSpecLanes], vocabulary.get('Lane')?.values);
    assert.deepEqual([...assemblyTransitionTypes], vocabulary.get('TransitionType')?.values);
    assert.deepEqual([...shotSpecTransitionTypes], vocabulary.get('TransitionType')?.values);
    assert.deepEqual([...briefFrameRates], vocabulary.get('FrameRate')?.values);
    assert.deepEqual([...CameraMoveValues], vocabulary.get('CameraMove')?.values);
    assert.deepEqual([...JobStatusValues], vocabulary.get('JobStatus')?.values);
    assert.deepEqual([...ShotStatusValues], vocabulary.get('ShotStatus')?.values);
  });
});
