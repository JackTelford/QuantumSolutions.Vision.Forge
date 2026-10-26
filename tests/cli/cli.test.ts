import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { CliResult } from '../../src/cli/result.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function cli(args: readonly string[], dataDir: string): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs: 60_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

describe('scripts/cli.ts', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-cli-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('help prints one JSON result with every planned command', async () => {
    const run = await cli(['help'], dataDir);
    assert.equal(run.exitCode, 0);
    assert.equal(run.result.kind, 'cli-result');
    assert.equal(run.result.ok, true);
    const data = run.result.data as { readonly commands: readonly { readonly name: string }[] };
    assert.deepEqual(data.commands.map((c) => c.name), ['help', 'version', 'doctor', 'validate', 'plan', 'still', 'render', 'sheet', 'assemble', 'qa', 'audio', 'assets']);
  });

  it('version reports the package version and node', async () => {
    const run = await cli(['version'], dataDir);
    assert.equal(run.exitCode, 0);
    const data = run.result.data as { readonly name: string; readonly node: string };
    assert.equal(data.name, 'vision-forge');
    assert.equal(data.node, process.version);
  });

  it('an unknown command is a usage error with exit code 2 and a JSON result', async () => {
    const run = await cli(['explode'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.errors[0]?.code, 'usage');
    assert.match(run.stderr, /Unknown command "explode"/);
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/);
  });

  it('a planned but unimplemented command says which milestone delivers it', async () => {
    const run = await cli(['render'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.equal(run.result.errors[0]?.code, 'not-implemented');
    assert.match(run.result.errors[0]?.hint ?? '', /milestone M3/);
  });

  it('an unknown option is a usage error', async () => {
    const run = await cli(['help', '--bogus'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.match(run.result.errors[0]?.message ?? '', /Unknown option --bogus/);
  });

  it('--pretty indents the result', async () => {
    const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, 'version', '--pretty', '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs: 60_000 }, never);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^\{\n {2}"kind": "cli-result"/);
  });
});
