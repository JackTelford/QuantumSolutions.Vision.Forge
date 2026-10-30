import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hdriByLighting } from '../../src/assets/catalogue.ts';
import { ProtocolError } from '../../src/mcp/jsonrpc.ts';
import { serverInstructions, studioPromptName, studioPrompts } from '../../src/mcp/prompts.ts';
import { knowledgeResources } from '../../src/mcp/resources.ts';
import type { ServerPaths } from '../../src/mcp/types.ts';

const paths: ServerPaths = { repositoryRoot: join('C:', 'repo'), dataDir: join('C:', 'data'), outDir: join('C:', 'Videos', 'Forge') };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The tools in the order a production uses them; each is named in backticks in the prompt text. */
const toolsInOrder: readonly string[] = ['doctor', 'assets', 'plan', 'still', 'approve_still', 'render', 'task_status', 'audio_install', 'audio_synth', 'assemble', 'qa', 'sheet'];

function firstMention(text: string, tool: string): number {
  return text.indexOf(`\`${tool}\``);
}

/** Every file uri a text names: a trailing full stop dropped, a folder prefix (ending in /) left out. */
function fileUrisIn(text: string): readonly string[] {
  const matches = text.match(/vision-forge:\/\/[A-Za-z0-9/_.<>-]+/g) ?? [];
  return [...new Set(matches.map((uri) => uri.replace(/\.$/, '')).filter((uri) => !uri.endsWith('/')))];
}

/** Asserts every uri the text names is one the server serves from the real repository; `schemas/<kind>.schema.json` is a pattern and matches any schema. */
function assertUrisServed(text: string, servedUris: readonly string[]): void {
  const named = fileUrisIn(text);
  assert.ok(named.length >= 3, `the text names resources, got ${named.length}`);
  for (const uri of named) {
    if (uri === 'vision-forge://schemas/<kind>.schema.json') {
      assert.ok(servedUris.some((candidate) => /^vision-forge:\/\/schemas\/[a-z-]+\.schema\.json$/.test(candidate)), 'a schema is served');
      continue;
    }
    assert.ok(servedUris.includes(uri), `${uri} is served`);
  }
}

describe('studioPrompts', () => {
  it('offers one prompt, cinematic-studio, with a required brief and an optional outDir', () => {
    const prompts = studioPrompts(paths);
    assert.equal(prompts.length, 1);
    const prompt = prompts[0];
    assert.equal(prompt?.name, studioPromptName);
    assert.ok((prompt?.description.length ?? 0) > 40);
    assert.deepEqual(prompt?.arguments.map((argument) => [argument.name, argument.required]), [['brief', true], ['outDir', false]]);
  });

  it('expands a brief to one user message that ends with the brief and names every tool in the order of a production', async () => {
    const brief = 'A 10-second title card that says "Hello from Vision Forge" on a dark background. 16:9.';
    const messages = await studioPrompts(paths)[0]!.get({ brief });
    assert.equal(messages.length, 1);
    const message = messages[0]!;
    assert.equal(message.role, 'user');
    assert.equal(message.content.type, 'text');
    const text = message.content.text;
    assert.ok(text.endsWith(`The brief:\n${brief}`), 'the brief closes the message');
    let previous = -1;
    for (const tool of toolsInOrder) {
      const index = firstMention(text, tool);
      assert.ok(index >= 0, `the prompt names \`${tool}\``);
      assert.ok(index > previous, `\`${tool}\` is first named after the tool before it`);
      previous = index;
    }
    assert.ok(firstMention(text, 'task_cancel') > firstMention(text, 'task_status'));
    assert.ok(firstMention(text, 'validate') > firstMention(text, 'plan'));
  });

  it('points only at resources the server serves, the output directory, the result document and the eleven steps', async () => {
    const text = (await studioPrompts(paths)[0]!.get({ brief: 'A still.' }))[0]!.content.text;
    const servedUris = knowledgeResources({ repositoryRoot: repoRoot, dataDir: paths.dataDir, outDir: paths.outDir }).map((resource) => resource.uri);
    for (const uri of ['vision-forge://references/direction/treatment-template.md', 'vision-forge://references/color/look-bible.md', 'vision-forge://examples/explainer/README.md', 'vision-forge://skill']) {
      assert.ok(text.includes(uri), `the prompt names ${uri}`);
    }
    assertUrisServed(text, servedUris);
    assertUrisServed(serverInstructions(paths), servedUris);
    assert.ok(text.includes(paths.outDir));
    assert.ok(text.includes('errors[]') && text.includes('hint'));
    assert.match(text, /\n11\. Say what was made\./);
    assert.ok(!/\n12\. /.test(text.split('Behaviour rules:')[0] ?? ''), 'the flow has eleven steps');
    assert.ok(text.includes('What it does not do'));
  });

  it('carries an outDir hint when one is given', async () => {
    const text = (await studioPrompts(paths)[0]!.get({ brief: 'A still.', outDir: join('D:', 'Deliveries') }))[0]!.content.text;
    assert.ok(text.includes(join('D:', 'Deliveries')));
    assert.ok(text.includes(paths.outDir));
  });

  it('names every lighting preset with its HDRI ids and the audio_synth outDir, so the model never guesses an id or a folder', async () => {
    const text = (await studioPrompts(paths)[0]!.get({ brief: 'A still.' }))[0]!.content.text;
    for (const [preset, hdri] of Object.entries(hdriByLighting)) {
      assert.ok(text.includes(`${preset}`), `the prompt names the ${preset} preset`);
      assert.ok(text.includes(`hdri:${hdri}-1k, hdri:${hdri}-2k`), `the prompt names both ids of ${hdri}`);
    }
    assert.ok(text.includes('pass outDir as <job>/narration'));
    assert.ok(!text.includes('--out <job>'), 'the prompt does not name a command-line option the tool lacks');
  });

  it('refuses a missing or blank brief as invalid params on the wire', async () => {
    await assert.rejects(studioPrompts(paths)[0]!.get({}), (error: unknown) => error instanceof ProtocolError && error.code === -32602);
    await assert.rejects(studioPrompts(paths)[0]!.get({ brief: '   ' }), (error: unknown) => error instanceof ProtocolError && error.code === -32602 && /arguments\.brief/.test(error.message));
  });
});

describe('serverInstructions', () => {
  it('names doctor before any other tool and says where files land, in about a dozen lines', () => {
    const text = serverInstructions(paths);
    const doctor = firstMention(text, 'doctor');
    assert.ok(doctor >= 0);
    for (const tool of toolsInOrder.slice(1)) {
      const index = firstMention(text, tool);
      assert.ok(index > doctor, `\`${tool}\` comes after \`doctor\``);
    }
    assert.ok(text.includes(paths.outDir));
    assert.ok(text.includes(paths.dataDir));
    const lineCount = text.split('\n').length;
    assert.ok(lineCount >= 10 && lineCount <= 20, `about a dozen lines, got ${lineCount}`);
    assert.ok(text.includes(`\`${studioPromptName}\``));
    assert.ok(text.includes('hdri:studio_small_09-1k') && text.includes('outDir set to <job>/narration'));
  });
});
