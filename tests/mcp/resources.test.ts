import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import { knowledgeResources, resolveSkillText, skillResourceUri, skillServedOverMcpNote } from '../../src/mcp/resources.ts';
import type { ResourceDefinition, ServerPaths } from '../../src/mcp/types.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skillRoot = join(repoRoot, 'skills', 'cinematic-studio');

let scratch: string;
let paths: ServerPaths;
let resources: readonly ResourceDefinition[];

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'vf-mcp-resources-'));
  paths = { repositoryRoot: repoRoot, dataDir: join(scratch, 'data'), outDir: join(scratch, 'project', 'out') };
  resources = knowledgeResources(paths);
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function uris(): readonly string[] {
  return resources.map((resource) => resource.uri);
}

/** The resource a uri names, looked up exactly as server.ts does; the test fails when it is not listed. */
function served(list: readonly ResourceDefinition[], uri: string): ResourceDefinition {
  const found = list.find((resource) => resource.uri === uri);
  assert.ok(found !== undefined, `${uri} is served`);
  return found;
}

/** Every file under a directory, depth first, as paths relative to it with forward slashes. */
function filesUnder(root: string, dir: string = root): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...filesUnder(root, path));
    else files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files;
}

describe('knowledgeResources', () => {
  it('lists the look bible and the steering table as markdown references named by their path', () => {
    const lookBible = served(resources, 'vision-forge://references/color/look-bible.md');
    assert.equal(lookBible.name, 'color/look-bible.md');
    assert.equal(lookBible.mimeType, 'text/markdown');
    assert.equal(lookBible.description, 'Look bible');
    const steering = served(resources, 'vision-forge://references/direction/steering-table.md');
    assert.equal(steering.description, 'Steering table');
  });

  it('lists every Markdown file under the references folder and nothing else under that prefix', () => {
    const referenceUris = uris().filter((uri) => uri.startsWith('vision-forge://references/'));
    const expected = filesUnder(join(skillRoot, 'references')).filter((file) => file.endsWith('.md')).map((file) => `vision-forge://references/${file}`);
    assert.ok(expected.includes('vision-forge://references/README.md'));
    assert.ok(expected.includes('vision-forge://references/lanes/capabilities-and-limits.md'));
    assert.deepEqual(new Set(referenceUris), new Set(expected));
  });

  it('lists every schema as application/json', () => {
    const schemaFiles = readdirSync(join(repoRoot, 'schemas')).filter((name) => name.endsWith('.schema.json'));
    assert.ok(schemaFiles.length >= 10);
    for (const file of schemaFiles) {
      const resource = served(resources, `vision-forge://schemas/${file}`);
      assert.equal(resource.mimeType, 'application/json');
      assert.equal(resource.name, file);
    }
    assert.ok(!uris().includes('vision-forge://schemas/vocabulary.json'), 'vocabulary.json is not a schema');
  });

  it('lists every document of both shipped examples with a mime type by extension', () => {
    for (const example of ['product-film', 'explainer']) {
      const files = readdirSync(join(skillRoot, 'examples', example));
      assert.ok(files.includes('brief.json') && files.includes('README.md'));
      for (const file of files) {
        const resource = served(resources, `vision-forge://examples/${example}/${file}`);
        const expected = file.endsWith('.json') ? 'application/json' : file.endsWith('.md') ? 'text/markdown' : 'text/plain';
        assert.equal(resource.mimeType, expected, `${example}/${file}`);
      }
    }
    assert.equal(served(resources, 'vision-forge://examples/explainer/narration-script.txt').mimeType, 'text/plain');
    assert.equal(served(resources, 'vision-forge://examples/explainer/README.md').description, 'Example: the explainer');
  });

  it('lists the skill last, as markdown', () => {
    const last = resources[resources.length - 1];
    assert.equal(last?.uri, skillResourceUri);
    assert.equal(last?.mimeType, 'text/markdown');
  });

  it('keeps every uri unique and serves nothing outside the three folders and the skill', () => {
    assert.equal(new Set(uris()).size, resources.length);
    for (const uri of uris()) assert.match(uri, /^vision-forge:\/\/(references\/|schemas\/|examples\/|skill$)/);
    assert.ok(!uris().includes('vision-forge://docs/handoff.md'));
  });

  it('reads a reference as the file on disk', async () => {
    const text = await served(resources, 'vision-forge://references/README.md').read();
    assert.match(text, /^# Knowledge base outline/);
  });

  it('reads the skill behind a served-over-MCP note, without its frontmatter and with every placeholder replaced by the server paths', async () => {
    const text = await served(resources, skillResourceUri).read();
    const note = skillServedOverMcpNote(paths);
    assert.ok(text.startsWith(`${note}\n\n# Cinematic Studio`), 'the note comes first, then the skill heading');
    assert.ok(note.includes('`approve_still`') && note.includes('shotSpec') && note.includes('do not run the command lines'));
    assert.ok(note.includes(paths.outDir.replaceAll('\\', '/')) && note.includes(paths.dataDir.replaceAll('\\', '/')));
    assert.ok(!text.includes('\nname: cinematic-studio'), 'the frontmatter is gone');
    assert.ok(!text.includes('${'), 'no placeholder is left');
    assert.ok(text.includes(`${repoRoot.replaceAll('\\', '/')}/scripts/cli.ts`), 'the plugin root became the repository root');
    assert.ok(text.includes(`--data-dir "${paths.dataDir.replaceAll('\\', '/')}"`), 'the plugin data became the data directory');
    assert.ok(text.includes(`--out "${paths.outDir.replaceAll('\\', '/')}"`), 'the project out became the output directory');
  });

  it('refuses a repository root without the skill', () => {
    assert.throws(() => knowledgeResources({ ...paths, repositoryRoot: scratch }), (error: unknown) => error instanceof VisionForgeError && error.code === 'repository-root');
  });
});

describe('resolveSkillText', () => {
  it('replaces a bare project directory by the parent of the output directory', () => {
    const text = resolveSkillText('---\nname: x\n---\n\n# Skill\n\nSee ${CLAUDE_PROJECT_DIR}/docs and ${CLAUDE_PROJECT_DIR}/out.', { repositoryRoot: 'C:/repo', dataDir: 'C:/data', outDir: 'C:/project/out' });
    assert.equal(text, '# Skill\n\nSee C:/project/docs and C:/project/out.');
  });

  it('leaves text without frontmatter alone', () => {
    assert.equal(resolveSkillText('# Plain\n', { repositoryRoot: '/r', dataDir: '/d', outDir: '/o' }), '# Plain\n');
  });
});

describe('a resource read goes to disk on each call', () => {
  it('returns the edited file without rebuilding the list, and rejects with a hint once the file is gone', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'vf-mcp-fake-repo-'));
    try {
      const references = join(fakeRoot, 'skills', 'cinematic-studio', 'references', 'color');
      mkdirSync(references, { recursive: true });
      mkdirSync(join(fakeRoot, 'schemas'), { recursive: true });
      mkdirSync(join(fakeRoot, 'skills', 'cinematic-studio', 'examples', 'tiny'), { recursive: true });
      writeFileSync(join(fakeRoot, 'skills', 'cinematic-studio', 'SKILL.md'), '---\nname: tiny\n---\n# Tiny\n');
      writeFileSync(join(references, 'look.md'), '# Look one\n');
      writeFileSync(join(fakeRoot, 'schemas', 'brief.schema.json'), '{"description":"A brief"}\n');
      writeFileSync(join(fakeRoot, 'skills', 'cinematic-studio', 'examples', 'tiny', 'brief.json'), '{}\n');
      const fake = knowledgeResources({ repositoryRoot: fakeRoot, dataDir: join(fakeRoot, 'data'), outDir: join(fakeRoot, 'out') });
      assert.deepEqual(fake.map((resource) => resource.uri), ['vision-forge://references/color/look.md', 'vision-forge://schemas/brief.schema.json', 'vision-forge://examples/tiny/brief.json', skillResourceUri]);
      assert.equal(served(fake, 'vision-forge://schemas/brief.schema.json').description, 'A brief');
      const look = served(fake, 'vision-forge://references/color/look.md');
      assert.equal(await look.read(), '# Look one\n');
      writeFileSync(join(references, 'look.md'), '# Look two\n');
      assert.equal(await look.read(), '# Look two\n');
      rmSync(join(references, 'look.md'));
      const pending = look.read();
      assert.ok(pending instanceof Promise, 'a missing file rejects instead of throwing synchronously');
      await assert.rejects(pending, (error: unknown) => error instanceof VisionForgeError && error.code === 'resource-missing' && error.hint.includes('restart the server'));
      rmSync(join(fakeRoot, 'skills', 'cinematic-studio', 'SKILL.md'));
      await assert.rejects(served(fake, skillResourceUri).read(), (error: unknown) => error instanceof VisionForgeError && error.code === 'resource-missing');
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});
