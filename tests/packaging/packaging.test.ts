import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skillDir = join(repoRoot, 'skills', 'cinematic-studio');
const workflows: readonly string[] = ['.github/workflows/ci.yml', '.github/workflows/blender-manual.yml'];

/** The frontmatter keys a skill may carry; anything else is Claude-Code-only or unknown and is left out. */
const allowedFrontmatterKeys: ReadonlySet<string> = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

/** The reference files references/README.md plans, in table order. */
const plannedReferences: readonly string[] = [
  'cinematography/shot-grammar.md',
  'cinematography/camera-moves.md',
  'cinematography/lens-and-exposure.md',
  'lighting/cookbook.md',
  'composition/rules.md',
  'typography/system.md',
  'motion/easing-grammar.md',
  'editing/pacing-and-transitions.md',
  'color/look-bible.md',
  'direction/treatment-template.md',
  'direction/steering-table.md',
  'direction/review-rubric.md',
  'lanes/capabilities-and-limits.md',
  'lanes/blender-notes.md',
];

function readText(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(relativePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readText(relativePath));
  assert.ok(isRecord(parsed), `${relativePath} is a JSON object`);
  return parsed;
}

/** Top-level frontmatter keys with their single-line values; indented lines belong to the key above them. */
function readFrontmatter(text: string): Map<string, string> {
  const lines = text.split('\n');
  assert.equal(lines[0], '---', 'SKILL.md opens with a frontmatter fence');
  const end = lines.indexOf('---', 1);
  assert.ok(end > 0, 'SKILL.md closes its frontmatter fence');
  const entries = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/.exec(line);
    if (match !== null) entries.set(match[1] ?? '', match[2] ?? '');
  }
  return entries;
}

/** The npm script names that package.json's `check` script runs, in order. */
function scriptsRunByCheck(): string[] {
  const scripts = readJsonObject('package.json')['scripts'];
  assert.ok(isRecord(scripts), 'package.json has scripts');
  const check = scripts['check'];
  assert.ok(typeof check === 'string', 'package.json defines a check script');
  return check.split('&&').map((part) => part.trim().replace(/^npm (?:run )?/, ''));
}

/** The file column of every outline row in references/README.md, in order. */
function outlineRows(): string[] {
  const rows: string[] = [];
  for (const line of readText('skills/cinematic-studio/references/README.md').split('\n')) {
    const match = /^\| `([^`]+)` \|/.exec(line);
    if (match !== null) rows.push(match[1] ?? '');
  }
  return rows;
}

describe('plugin manifests', () => {
  it('names the same plugin in marketplace.json and plugin.json, sourced from the repository root', () => {
    const plugin = readJsonObject('.claude-plugin/plugin.json');
    const marketplace = readJsonObject('.claude-plugin/marketplace.json');
    const plugins = marketplace['plugins'];
    assert.ok(Array.isArray(plugins) && plugins.length === 1, 'marketplace.json lists one plugin');
    const entry: unknown = plugins[0];
    assert.ok(isRecord(entry), 'the plugin entry is an object');
    assert.equal(typeof plugin['name'], 'string');
    assert.equal(entry['name'], plugin['name']);
    assert.equal(entry['source'], './');
    assert.equal(entry['description'], undefined, 'the entry does not repeat the description plugin.json holds');
    assert.equal(typeof marketplace['description'], 'string', 'the marketplace keeps its own description');
  });
});

describe('SKILL.md frontmatter', () => {
  const frontmatter = readFrontmatter(readText('skills/cinematic-studio/SKILL.md'));

  it('is named after its directory', () => {
    assert.equal(frontmatter.get('name'), basename(skillDir));
  });

  it('keeps the description within 1024 characters', () => {
    const description = frontmatter.get('description') ?? '';
    assert.ok(description.length > 0, 'the description is present');
    assert.ok(description.length <= 1024, `description is ${description.length} characters`);
  });

  it('uses only the fields every skill loader reads', () => {
    const unexpected = [...frontmatter.keys()].filter((key) => !allowedFrontmatterKeys.has(key));
    assert.deepEqual(unexpected, []);
  });
});

describe('SKILL.md knowledge base', () => {
  it('points at references/README.md and links no reference file directly', () => {
    const text = readText('skills/cinematic-studio/SKILL.md');
    assert.ok(text.includes('(references/README.md)'), 'the README pointer is present');
    const otherLinks = text.match(/\(references\/(?!README\.md)[^)]+\)/g) ?? [];
    assert.deepEqual(otherLinks, []);
  });
});

describe('references/README.md', () => {
  it('lists exactly the 14 planned files', () => {
    assert.equal(plannedReferences.length, 14);
    assert.deepEqual(outlineRows(), plannedReferences);
  });
});

describe('workflows', () => {
  for (const workflow of workflows) {
    it(`${workflow} has no tabs, no CR and no trailing spaces`, () => {
      const text = readText(workflow);
      assert.ok(!text.includes('\t'), 'no tabs');
      assert.ok(!text.includes('\r'), 'no CR');
      const trailing = text.split('\n').findIndex((line) => line.endsWith(' '));
      assert.equal(trailing, -1, `line ${trailing + 1} has trailing spaces`);
      assert.ok(text.endsWith('\n'), 'ends with a newline');
    });
  }

  it('ci.yml names every npm script that package.json runs for check', () => {
    const ci = readText('.github/workflows/ci.yml');
    const scripts = scriptsRunByCheck();
    assert.ok(scripts.length > 0, 'check runs at least one script');
    for (const script of scripts) {
      const command = script === 'test' ? 'npm test' : `npm run ${script}`;
      assert.ok(ci.includes(`\n          ${command}\n`), `ci.yml runs ${command}`);
    }
  });
});
