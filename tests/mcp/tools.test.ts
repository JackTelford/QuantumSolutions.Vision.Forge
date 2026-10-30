import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CliResult } from '../../src/cli/result.ts';
import { UsageError } from '../../src/errors/vision-forge-error.ts';
import { buildArgv, isBackground } from '../../src/mcp/tools/command-tool.ts';
import { commandToolSpecs, commandTools, findToolSpec } from '../../src/mcp/tools/index.ts';
import { allowedRoots, isUnderRoot, pathNotAllowedCode, resolveAllowedPath } from '../../src/mcp/tools/path-policy.ts';
import { TaskTable } from '../../src/mcp/tools/tasks.ts';
import type { ServerPaths, ToolCallContext } from '../../src/mcp/types.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const paths: ServerPaths = { outDir: join(tmpdir(), 'vf-mcp-tools', 'out'), dataDir: join(tmpdir(), 'vf-mcp-tools', 'data'), repositoryRoot: repoRoot };
const out = (name: string): string => resolve(paths.outDir, name);
const never = new AbortController().signal;

/** A spec by name; fails the test when the table has none. */
function spec(name: string): NonNullable<ReturnType<typeof findToolSpec>> {
  const found = findToolSpec(name);
  assert.ok(found !== undefined, `the tool table has ${name}`);
  return found;
}

/** A call context over the test paths that keeps every reported line. */
function context(): ToolCallContext & { readonly lines: string[] } {
  const lines: string[] = [];
  return { signal: never, report: (message) => { lines.push(message); }, dataDir: paths.dataDir, outDir: paths.outDir, repositoryRoot: repoRoot, lines };
}

describe('command tool argv', () => {
  const rows: readonly { readonly tool: string; readonly input: Record<string, unknown>; readonly argv: readonly string[] }[] = [
    { tool: 'doctor', input: { require: 'three', skipBrowserCheck: true, skipBlenderProbe: false, background: true }, argv: ['doctor', '--require', 'three', '--skip-browser-check'] },
    { tool: 'validate', input: { path: 'brief.json' }, argv: ['validate', out('brief.json')] },
    { tool: 'plan', input: { brief: 'b.json', treatment: out('t.json'), shotSpec: 's.json', look: 'l.json' }, argv: ['plan', '--brief', out('b.json'), '--treatment', out('t.json'), '--shot-spec', out('s.json'), '--look', out('l.json')] },
    { tool: 'still', input: { job: 'job1', shot: 's01', frame: 12, renderer: 'any', scale: 2 }, argv: ['still', '--job', out('job1'), '--shot', 's01', '--frame', '12', '--renderer', 'any', '--scale', '2'] },
    { tool: 'approve_still', input: { job: 'job1', shot: 's01' }, argv: ['still', '--approve', '--job', out('job1'), '--shot', 's01'] },
    { tool: 'render', input: { job: 'job1/job.json', shot: 's02', renderer: 'hardware', frames: '0-9', force: true, allowUnapproved: true, wait: true }, argv: ['render', '--job', out('job1/job.json'), '--shot', 's02', '--renderer', 'hardware', '--frames', '0-9', '--force', '--allow-unapproved'] },
    { tool: 'assemble', input: { job: 'job1', music: 'm.wav', musicGain: -9, burnIn: true, codec: 'prores', outFile: 'd.mov' }, argv: ['assemble', '--job', out('job1'), '--music', out('m.wav'), '--music-gain', '-9', '--burn-in', '--codec', 'prores', '--out-file', out('d.mov')] },
    { tool: 'assemble', input: { plan: 'plan.json' }, argv: ['assemble', '--plan', out('plan.json')] },
    { tool: 'qa', input: { job: 'job1', report: 'r.json', loudnessTarget: -14, noFail: true }, argv: ['qa', '--job', out('job1'), '--report', out('r.json'), '--loudness-target', '-14', '--no-fail'] },
    { tool: 'qa', input: { video: 'd.mp4', plan: 'plan.json', textBoxes: 'boxes.json', still: 'hero.png', stillFrame: 42 }, argv: ['qa', '--video', out('d.mp4'), '--plan', out('plan.json'), '--text-boxes', out('boxes.json'), '--still', out('hero.png'), '--still-frame', '42'] },
    { tool: 'sheet', input: { video: 'v.mp4', every: 15, output: 's.png', columns: 3, thumbWidth: 320 }, argv: ['sheet', '--video', out('v.mp4'), '--every', '15', '--output', out('s.png'), '--columns', '3', '--thumb-width', '320'] },
    { tool: 'sheet', input: { frames: 'job1/stills' }, argv: ['sheet', '--frames', out('job1/stills')] },
    { tool: 'assets', input: { fetch: ['hdri:studio_small_09-1k', 'hdri:moonless_golf-2k'], verify: true }, argv: ['assets', '--fetch', 'hdri:studio_small_09-1k,hdri:moonless_golf-2k', '--verify'] },
    { tool: 'assets', input: { list: true, all: false, credits: true }, argv: ['assets', '--list', '--credits'] },
    { tool: 'assets', input: { creditsPath: 'credits/CREDITS.md' }, argv: ['assets', '--credits-path', out('credits/CREDITS.md')] },
    { tool: 'audio_install', input: { yes: true, verify: true }, argv: ['audio', 'install', '--yes', '--verify'] },
    { tool: 'audio_status', input: {}, argv: ['audio', 'status'] },
    { tool: 'audio_voices', input: { background: false }, argv: ['audio', 'voices'] },
    { tool: 'audio_synth', input: { text: 'Hello there.', voice: 'af_heart', fps: 30, gap: 0.5, outDir: 'narr' }, argv: ['audio', 'synth', '--text', 'Hello there.', '--voice', 'af_heart', '--fps', '30', '--gap', '0.5', '--out-dir', out('narr')] },
    { tool: 'audio_synth', input: { script: 'script.txt' }, argv: ['audio', 'synth', '--script', out('script.txt')] },
  ];
  for (const row of rows) {
    it(`builds ${JSON.stringify(row.argv)} for ${row.tool} from ${JSON.stringify(row.input)}`, () => {
      assert.deepEqual(buildArgv(spec(row.tool), row.input, paths), row.argv);
    });
  }

  it('accepts a numeric string for a number and leaves the check to the command', () => {
    assert.deepEqual(buildArgv(spec('still'), { job: 'j', shot: 's01', frame: '7' }, paths), ['still', '--job', out('j'), '--shot', 's01', '--frame', '7']);
  });

  it('refuses a value of the wrong type, an unknown key and a non-finite number as usage errors naming the key', () => {
    assert.throws(() => buildArgv(spec('render'), { job: 'j', force: 'yes' }, paths), (error: unknown) => error instanceof UsageError && /"force" must be true or false/.test(error.message));
    assert.throws(() => buildArgv(spec('assets'), { fetch: 'hdri:a' }, paths), (error: unknown) => error instanceof UsageError && /"fetch" must be an array of strings/.test(error.message));
    assert.throws(() => buildArgv(spec('still'), { job: 'j', shot: 's01', frame: Number.NaN }, paths), (error: unknown) => error instanceof UsageError && /"frame" must be a finite number/.test(error.message));
    assert.throws(() => buildArgv(spec('doctor'), { requires: 'three' }, paths), (error: unknown) => error instanceof UsageError && /Unknown input "requires" for doctor/.test(error.message) && /require, skipBrowserCheck, skipBlenderProbe, background/.test(error.hint));
    assert.throws(() => buildArgv(spec('still'), { job: 'j', shot: 's01', scale: { x: 2 } }, paths), (error: unknown) => error instanceof UsageError && /"scale" must be a number, got an object/.test(error.message));
  });

  it('reads background on every tool and wait, inverted, on render', () => {
    for (const entry of commandToolSpecs) {
      if (entry.name === 'render') continue;
      assert.equal(isBackground(entry, {}), false, entry.name);
      assert.equal(isBackground(entry, { background: true }), true, entry.name);
    }
    assert.equal(isBackground(spec('render'), {}), true);
    assert.equal(isBackground(spec('render'), { wait: false }), true);
    assert.equal(isBackground(spec('render'), { wait: true }), false);
    assert.throws(() => isBackground(spec('render'), { wait: 'no' }), UsageError);
  });
});

describe('path policy', () => {
  const home = join(tmpdir(), 'vf-mcp-tools', 'home');
  const outside = resolve('/definitely-not-allowed/vision-forge');

  it('accepts a path under each of the four roots and resolves a relative one against the output directory', () => {
    assert.deepEqual(allowedRoots(paths, home), [resolve(paths.outDir), resolve(paths.dataDir), resolve(repoRoot), resolve(home)]);
    assert.equal(resolveAllowedPath(join(paths.outDir, 'job', 'job.json'), paths, 'the job', home), join(paths.outDir, 'job', 'job.json'));
    assert.equal(resolveAllowedPath(join(paths.dataDir, 'cache'), paths, 'the cache', home), join(paths.dataDir, 'cache'));
    assert.equal(resolveAllowedPath(join(repoRoot, 'skills', 'cinematic-studio', 'examples'), paths, 'the examples', home), join(repoRoot, 'skills', 'cinematic-studio', 'examples'));
    assert.equal(resolveAllowedPath(join(home, 'Videos', 'music.wav'), paths, 'the music', home), join(home, 'Videos', 'music.wav'));
    assert.equal(resolveAllowedPath('abc123/stills', paths, 'the stills', home), join(paths.outDir, 'abc123', 'stills'));
    assert.equal(resolveAllowedPath(paths.outDir, paths, 'the root itself', home), resolve(paths.outDir));
  });

  it('refuses a path outside the roots, one that climbs out with .., and an empty one, naming the roots in the hint', () => {
    assert.throws(() => resolveAllowedPath(outside, paths, 'the job', home), (error: unknown) => {
      assert.ok(error instanceof Error && 'code' in error && 'hint' in error);
      const { code, hint, message } = error as { code: string; hint: string; message: string };
      assert.equal(code, pathNotAllowedCode);
      assert.match(message, /The path for the job/);
      for (const root of allowedRoots(paths, home)) assert.ok(hint.includes(root), `hint names ${root}`);
      return true;
    });
    assert.throws(() => resolveAllowedPath(join('..', '..', '..', '..', '..', '..', 'definitely-not-allowed'), paths, 'the frames', home), (error: unknown) => (error as { code: string }).code === pathNotAllowedCode);
    assert.throws(() => resolveAllowedPath('   ', paths, 'the frames', home), (error: unknown) => (error as { code: string }).code === pathNotAllowedCode && /is empty/.test((error as Error).message));
  });

  it('does not mistake a sibling whose name starts with the root for a child of it', () => {
    assert.equal(isUnderRoot(`${paths.outDir}-other`, paths.outDir), false);
    assert.equal(isUnderRoot(join(paths.outDir, 'x'), paths.outDir), true);
    assert.equal(isUnderRoot(join(paths.outDir, '..'), paths.outDir), false);
    // Folded without case on Windows; a host's own path.relative decides the rest, so no assertion pretends to be another platform.
    assert.equal(isUnderRoot(join(paths.outDir, 'X').toUpperCase(), paths.outDir, 'win32'), true);
  });
});

describe('the tool table', () => {
  const tasks = new TaskTable();
  const tools = commandTools(paths, tasks);
  const byName = (name: string): NonNullable<(typeof tools)[number]> => {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(tool !== undefined, name);
    return tool;
  };

  it('lists the sixteen command tools in flow order and the two task tools after them', () => {
    assert.deepEqual(tools.map((tool) => tool.name), ['doctor', 'validate', 'plan', 'still', 'approve_still', 'render', 'assemble', 'qa', 'sheet', 'assets', 'audio_install', 'audio_status', 'audio_voices', 'audio_synth', 'task_status', 'task_cancel']);
    for (const tool of tools) assert.match(tool.name, /^[a-z0-9_]+$/);
  });

  it('marks the tools that render or encode exclusive and the others not', () => {
    const exclusive = tools.filter((tool) => tool.exclusive === true).map((tool) => tool.name);
    assert.deepEqual(exclusive, ['still', 'render', 'assemble', 'qa', 'sheet', 'audio_install', 'audio_synth']);
  });

  it('annotates read-only, destructive and open-world hints as the ADR decides; doctor writes tools.json, so it is idempotent, not read-only', () => {
    assert.deepEqual(tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name), ['validate', 'audio_status', 'audio_voices', 'task_status']);
    assert.deepEqual(tools.filter((tool) => tool.annotations?.openWorldHint === true).map((tool) => tool.name), ['assets', 'audio_install']);
    assert.deepEqual(tools.filter((tool) => tool.annotations?.idempotentHint === true).map((tool) => tool.name), ['doctor']);
    for (const tool of tools) assert.equal(tool.annotations?.destructiveHint, false, tool.name);
  });

  it('mirrors every option of qa, assemble and assets, the job-less modes included', () => {
    assert.deepEqual(Object.keys(byName('qa').inputSchema.properties), ['job', 'video', 'plan', 'textBoxes', 'still', 'stillFrame', 'report', 'loudnessTarget', 'noFail', 'background']);
    assert.equal(byName('qa').inputSchema.required, undefined, 'job or video, so neither is required by the schema');
    assert.ok(Object.keys(byName('assemble').inputSchema.properties).includes('plan'));
    assert.equal(byName('assemble').inputSchema.required, undefined);
    assert.ok(Object.keys(byName('assets').inputSchema.properties).includes('creditsPath'));
  });

  it('gives every property a description, closes every schema, and offers background everywhere but render, which offers wait', () => {
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      assert.ok(tool.description.length > 40, tool.name);
      for (const [key, property] of Object.entries(tool.inputSchema.properties)) {
        assert.equal(typeof (property as { description?: unknown }).description, 'string', `${tool.name}.${key}`);
      }
      const keys = Object.keys(tool.inputSchema.properties);
      if (tool.name === 'render') assert.ok(keys.includes('wait') && !keys.includes('background'));
      else if (tool.name.startsWith('task_')) assert.deepEqual(keys, ['taskId']);
      else assert.ok(keys.includes('background'), tool.name);
      for (const required of tool.inputSchema.required ?? []) assert.ok(keys.includes(required), `${tool.name} requires ${required}`);
    }
    assert.deepEqual(byName('plan').inputSchema.required, ['brief', 'treatment', 'shotSpec', 'look']);
    assert.deepEqual(byName('still').inputSchema.required, ['job', 'shot']);
  });

  it('turns a refused path into a failure result with code path-not-allowed instead of throwing', async () => {
    const ctx = context();
    const result = await byName('qa').run({ job: resolve('/definitely-not-allowed/job') }, ctx);
    assert.equal(result.isError, true);
    const document = result.structuredContent as unknown as CliResult;
    assert.equal(document.kind, 'cli-result');
    assert.equal(document.command, 'qa');
    assert.equal(document.ok, false);
    assert.equal(document.exitCode, 2);
    assert.equal(document.errors[0]?.code, pathNotAllowedCode);
    assert.ok(document.errors[0]?.hint.includes(resolve(paths.outDir)));
    assert.equal(result.content[0]?.type, 'text');
    assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), document);
  });

  it('turns a wrong input type into a usage failure result and never reaches the command', async () => {
    const result = await byName('assets').run({ fetch: 'hdri:studio_small_09-1k' }, context());
    assert.equal(result.isError, true);
    const document = result.structuredContent as unknown as CliResult;
    assert.equal(document.errors[0]?.code, 'usage');
    assert.match(document.errors[0]?.message ?? '', /"fetch" must be an array of strings/);
  });

  it('answers a bad input with the usage failure even with background true, and starts no task for it', async () => {
    const before = tasks.ids().length;
    const unknownKey = await byName('audio_status').run({ background: true, bogus: 1 }, context());
    assert.equal(unknownKey.isError, true);
    const document = unknownKey.structuredContent as unknown as CliResult;
    assert.equal(document.errors[0]?.code, 'usage');
    assert.match(document.errors[0]?.message ?? '', /Unknown input "bogus" for audio_status/);
    const refusedPath = await byName('render').run({ job: resolve('/definitely-not-allowed/job') }, context());
    assert.equal((refusedPath.structuredContent as unknown as CliResult).errors[0]?.code, pathNotAllowedCode, 'render without wait is a task, but the path is refused in the call');
    const wrongType = await byName('sheet').run({ frames: 'f', columns: true, background: true }, context());
    assert.match((wrongType.structuredContent as unknown as CliResult).errors[0]?.message ?? '', /"columns" must be a number/);
    assert.equal(tasks.ids().length, before, 'no task was started for a call that failed its pre-flight');
  });
});
