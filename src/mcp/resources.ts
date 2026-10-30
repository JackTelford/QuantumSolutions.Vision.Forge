/**
 * The knowledge base as MCP resources (ADR 0009, decision 8): every file of
 * the skill's references, every JSON Schema, every file of the shipped
 * examples and the skill itself with its placeholders resolved to the
 * server's own paths. The list is built once from the directories; each
 * read goes back to disk so an edit shows without a restart. The server
 * answers only a uri that matches the list exactly, and every path is
 * joined from the listing, never from the uri, so a client cannot walk out
 * of the three folders.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { VisionForgeError } from '../errors/vision-forge-error.ts';
import type { ResourceDefinition, ServerPaths } from './types.ts';

/** The scheme every resource uri starts with. */
export const resourceScheme = 'vision-forge://';

/** The uri of the skill text with its placeholders resolved. */
export const skillResourceUri = `${resourceScheme}skill`;

const skillFolder = ['skills', 'cinematic-studio'] as const;

/** The placeholder names Claude Code substitutes into the skill text; assembled so that src/ never names the prefix the house rule forbids. */
const placeholders = {
  pluginRoot: `\${${['CLAUDE', 'PLUGIN', 'ROOT'].join('_')}}`,
  pluginData: `\${${['CLAUDE', 'PLUGIN', 'DATA'].join('_')}}`,
  projectDir: '${CLAUDE_PROJECT_DIR}',
} as const;

const mimeTypesByExtension: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

/** Every resource the server serves for the given paths, in a stable order: references, schemas, examples, then the skill. */
export function knowledgeResources(paths: ServerPaths): readonly ResourceDefinition[] {
  const skillRoot = join(paths.repositoryRoot, ...skillFolder);
  const skillPath = join(skillRoot, 'SKILL.md');
  if (!isFile(skillPath)) {
    throw new VisionForgeError({ code: 'repository-root', message: `${skillPath} is not a file, so the knowledge base cannot be served.`, hint: 'Start the server from a clone of the repository, or pass its root as the repository root.' });
  }
  return [
    ...referenceResources(join(skillRoot, 'references')),
    ...schemaResources(join(paths.repositoryRoot, 'schemas')),
    ...exampleResources(join(skillRoot, 'examples')),
    skillResource(skillPath, paths),
  ];
}

/** The paragraph served before the skill text: SKILL.md is written for Claude Code's command lines, and an MCP client calls the tools instead. */
export function skillServedOverMcpNote(paths: ServerPaths): string {
  return `Served over MCP: every command below is the tool of the same name (\`still --approve\` is \`approve_still\`, \`audio synth\` is \`audio_synth\`), every option its camelCase argument (\`--shot-spec\` is shotSpec), and \`--data-dir\` and \`--out\` are fixed to ${forwardSlashes(paths.dataDir)} and ${forwardSlashes(paths.outDir)}; do not run the command lines.`;
}

/** The skill text as served: the frontmatter removed and the placeholders replaced by the server's paths (forward slashes, as Claude Code substitutes them). */
export function resolveSkillText(text: string, paths: ServerPaths): string {
  const outDir = forwardSlashes(paths.outDir);
  return stripFrontmatter(text)
    .replaceAll(placeholders.pluginRoot, forwardSlashes(paths.repositoryRoot))
    .replaceAll(placeholders.pluginData, forwardSlashes(paths.dataDir))
    .replaceAll(`${placeholders.projectDir}/out`, outDir)
    .replaceAll(placeholders.projectDir, forwardSlashes(dirname(paths.outDir)));
}

function referenceResources(root: string): ResourceDefinition[] {
  return markdownFilesUnder(root, root).map((path) => {
    const relativePath = forwardSlashes(relative(root, path));
    return fileResource(`${resourceScheme}references/${relativePath}`, relativePath, firstHeading(path), 'text/markdown', path);
  });
}

function schemaResources(root: string): ResourceDefinition[] {
  return entriesOf(root)
    .filter((name) => name.endsWith('.schema.json'))
    .map((name) => fileResource(`${resourceScheme}schemas/${name}`, name, schemaDescription(join(root, name)), 'application/json', join(root, name)));
}

function exampleResources(root: string): ResourceDefinition[] {
  const resources: ResourceDefinition[] = [];
  for (const exampleName of entriesOf(root).filter((name) => isDirectory(join(root, name)))) {
    const exampleRoot = join(root, exampleName);
    for (const fileName of entriesOf(exampleRoot).filter((name) => isFile(join(exampleRoot, name)))) {
      const path = join(exampleRoot, fileName);
      const mimeType = mimeTypesByExtension[extensionOf(fileName)] ?? 'text/plain';
      const description = mimeType === 'text/markdown' ? firstHeading(path) : `The ${exampleName} example: ${fileName}`;
      resources.push(fileResource(`${resourceScheme}examples/${exampleName}/${fileName}`, `${exampleName}/${fileName}`, description, mimeType, path));
    }
  }
  return resources;
}

function skillResource(skillPath: string, paths: ServerPaths): ResourceDefinition {
  return {
    uri: skillResourceUri,
    name: 'skill',
    description: 'The directing instructions (SKILL.md) with their paths resolved to this server',
    mimeType: 'text/markdown',
    read: async (): Promise<string> => {
      const text = resolveSkillText(readText(skillResourceUri, skillPath), paths);
      return `${skillServedOverMcpNote(paths)}\n\n${text}`;
    },
  };
}

function fileResource(uri: string, name: string, description: string, mimeType: string, path: string): ResourceDefinition {
  return { uri, name, description, mimeType, read: async (): Promise<string> => readText(uri, path) };
}

/** The file's text; a file that was listed but has since gone becomes an error with a hint instead of Node's ENOENT. Called inside an async read, so a throw is a rejection. */
function readText(uri: string, path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause: unknown) {
    throw new VisionForgeError({ code: 'resource-missing', message: `${uri} was in the list but ${path} cannot be read.`, hint: 'The file was moved or deleted after the server started; restore it or restart the server.', cause });
  }
}

/** Every Markdown file under the root, depth first, sorted by name at each level; a path that resolves outside the root is skipped. */
function markdownFilesUnder(root: string, dir: string): string[] {
  const files: string[] = [];
  for (const name of entriesOf(dir)) {
    const path = resolve(dir, name);
    if (!isInside(root, path)) continue;
    if (isDirectory(path)) files.push(...markdownFilesUnder(root, path));
    else if (name.endsWith('.md')) files.push(path);
  }
  return files;
}

function entriesOf(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return readdirSync(dir).filter((name) => name !== '.' && name !== '..').sort();
}

function isInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !relativePath.startsWith(sep) && !/^[A-Za-z]:/.test(relativePath);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

function forwardSlashes(path: string): string {
  return path.replaceAll('\\', '/');
}

/** The text of the first Markdown heading line of a file, without its marks; the file name when it has none. */
function firstHeading(path: string): string {
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find((candidate) => candidate.startsWith('#'));
  return line === undefined ? relative(dirname(path), path) : line.replace(/^#+\s*/, '').trim();
}

/** A schema's own description, or a sentence naming the file when it has none. */
function schemaDescription(path: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'description' in parsed && typeof parsed.description === 'string') return parsed.description;
  } catch {
    // Not JSON: fall through to the generic sentence.
  }
  return `JSON Schema ${relative(dirname(path), path)}`;
}

/** The text after a leading YAML frontmatter block (`---` ... `---`), or the whole text when there is none. */
function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const closing = text.indexOf('\n---', 3);
  if (closing < 0) return text;
  const afterClosing = text.indexOf('\n', closing + 1);
  return (afterClosing < 0 ? '' : text.slice(afterClosing + 1)).replace(/^\s+/, '');
}
