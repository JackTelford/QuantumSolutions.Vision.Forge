import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { documentKinds, schemaFor } from '../../src/schema/schema-registry.ts';
import { ExitCodeValues } from '../../src/shared/contracts/cli-result.ts';
import { LaneValues, RenderStatusValues, RendererValues } from '../../src/shared/contracts/render-manifest.ts';
import { ChannelValues, OperatingSystemValues } from '../../src/shared/contracts/tools.ts';
import { StaleReasons, compileContract, contractsDir, describeStale, enumValueArrays, findStaleContracts, generateContract, generateContracts, repoRoot, writeContracts } from '../../scripts/gen-types.ts';

const genTypesPath = join(repoRoot, 'scripts', 'gen-types.ts');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

describe('scripts/gen-types.ts', () => {
  let generated: ReadonlyMap<string, string>;
  let dir = '';
  before(async () => {
    generated = await generateContracts();
    dir = mkdtempSync(join(tmpdir(), 'vf-contracts-'));
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('generates one contract file per document kind with the generated header', () => {
    assert.deepEqual([...generated.keys()], documentKinds.map((kind) => `${kind}.ts`));
    for (const kind of documentKinds) {
      const text = generated.get(`${kind}.ts`) ?? '';
      assert.ok(text.startsWith(`/** @generated from schemas/${kind}.schema.json by scripts/gen-types.ts. Do not edit. */\n\n`), kind);
      assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), `${kind} ends with exactly one newline`);
      assert.ok(!text.includes('\r'), `${kind} has CRLF`);
      assert.ok(!/\bany\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, '')), `${kind} must not use any`);
    }
  });

  it('matches the committed files byte for byte (the --check contract)', () => {
    assert.deepEqual(findStaleContracts(generated, contractsDir), []);
  });

  it('is byte-deterministic across runs', async () => {
    const again = await generateContracts();
    assert.deepEqual([...again], [...generated]);
    assert.equal(await generateContract('tools'), generated.get('tools.ts'));
  });

  it('maps the any-JSON idiom to unknown and names enumerations after their definitions', () => {
    const cliResult = generated.get('cli-result.ts') ?? '';
    assert.match(cliResult, /\n {2}data: unknown;\n/);
    assert.match(cliResult, /\nexport type ExitCode = 0 \| 1 \| 2 \| 130;\n/);
    assert.match(cliResult, /\n {2}exitCode: ExitCode;\n/);
    assert.match(generated.get('tools.ts') ?? '', /\n {4}os: OperatingSystem;\n/);
  });

  it('refuses a schema without a title, which would name the root type after the $id', async () => {
    const untitled = { $id: 'https://vision-forge.quantumsolutions.dev/schemas/foo.schema.json', type: 'object', additionalProperties: false, required: [], properties: {} };
    await assert.rejects(compileContract('foo', untitled), { message: 'schemas/foo.schema.json has no title; the generated root type is named after it.' });
  });

  it('refuses a non-local $ref instead of fetching it', async () => {
    const remote = { $id: 'https://vision-forge.quantumsolutions.dev/schemas/foo.schema.json', title: 'Foo', type: 'object', additionalProperties: false, required: [], properties: { a: { $ref: 'http://127.0.0.1:1/x.json' } } };
    await assert.rejects(compileContract('foo', remote), /Unable to resolve \$ref pointer "http:\/\/127\.0\.0\.1:1\/x\.json"/);
  });

  it('emits a value array for every enumeration in $defs order', () => {
    assert.equal(enumValueArrays(schemaFor('cli-result')), '\n/** Every ExitCode value the schema allows, in schema order. */\nexport const ExitCodeValues = [0, 1, 2, 130] as const;\n');
    assert.equal(enumValueArrays({ $defs: { Plain: { type: 'object' } } }), '');
    assert.equal(enumValueArrays({ $defs: { Q: { enum: ["it's", 'a\\b'] } } }), "\n/** Every Q value the schema allows, in schema order. */\nexport const QValues = ['it\\'s', 'a\\\\b'] as const;\n");
  });

  it('the committed value arrays agree with the schemas', () => {
    const defsOf = (kind: string): Record<string, unknown> => schemaFor(kind)['$defs'] as Record<string, unknown>;
    const enumOf = (kind: string, name: string): unknown => (defsOf(kind)[name] as { enum: unknown }).enum;
    assert.deepEqual([...ExitCodeValues], enumOf('cli-result', 'ExitCode'));
    assert.deepEqual([...ChannelValues], enumOf('tools', 'Channel'));
    assert.deepEqual([...OperatingSystemValues], enumOf('tools', 'OperatingSystem'));
    assert.deepEqual([...LaneValues], enumOf('render-manifest', 'Lane'));
    assert.deepEqual([...RendererValues], enumOf('render-manifest', 'Renderer'));
    assert.deepEqual([...RenderStatusValues], enumOf('render-manifest', 'RenderStatus'));
  });

  it('reports a modified, a missing and an orphan contract file in a copy', () => {
    writeContracts(generated, dir);
    assert.deepEqual(findStaleContracts(generated, dir), []);
    writeFileSync(join(dir, 'tools.ts'), `${readFileSync(join(dir, 'tools.ts'), 'utf8')}// edited by hand\n`, 'utf8');
    unlinkSync(join(dir, 'cli-result.ts'));
    writeFileSync(join(dir, 'scene.ts'), 'export type Scene = never;\n', 'utf8');
    assert.deepEqual(findStaleContracts(generated, dir), [
      { file: 'cli-result.ts', reason: StaleReasons.missing },
      { file: 'tools.ts', reason: StaleReasons.differs },
      { file: 'scene.ts', reason: StaleReasons.orphan },
    ]);
  });

  it('--check advice says to regenerate for missing and differing files and to delete orphans, which regenerating never removes', () => {
    assert.deepEqual(describeStale([
      { file: 'cli-result.ts', reason: StaleReasons.missing },
      { file: 'tools.ts', reason: StaleReasons.differs },
      { file: 'scene.ts', reason: StaleReasons.orphan },
    ], contractsDir), [
      'stale: src/shared/contracts/cli-result.ts is missing for schemas/cli-result.schema.json',
      'stale: src/shared/contracts/tools.ts differs from schemas/tools.schema.json',
      'stale: src/shared/contracts/scene.ts has no schemas/scene.schema.json',
      'Run "npm run schema:gen" and commit the result.',
      'Delete src/shared/contracts/scene.ts; it has no schema.',
    ]);
    assert.deepEqual(describeStale([{ file: 'scene.ts', reason: StaleReasons.orphan }], contractsDir), [
      'stale: src/shared/contracts/scene.ts has no schemas/scene.schema.json',
      'Delete src/shared/contracts/scene.ts; it has no schema.',
    ]);
  });

  it('--check exits 0 against the committed files', async () => {
    const result = await runner.run({ label: 'gen-types', executable: process.execPath, args: [genTypesPath, '--check'], cwd: repoRoot, timeoutMs: 120_000 }, never);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^3 contract files are up to date\.\n$/);
  });

  it('an unknown argument is a usage error with exit code 2', async () => {
    const result = await runner.run({ label: 'gen-types', executable: process.execPath, args: [genTypesPath, '--watch'], cwd: repoRoot, timeoutMs: 120_000 }, never);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /Unknown argument --watch/);
  });
});
