import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CliResult } from '../../src/cli/result.ts';
import { writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { AssetLedger, assetLedgerPath } from '../../src/net/asset-ledger.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { ValidateData } from '../../src/cli/commands/validate.ts';
import { assetsLedgerExample, briefExample, lookBibleExample, mutated, shotSpecExample } from '../schema/documents/examples.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function validate(args: readonly string[], dataDir: string, cwd = repoRoot): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, 'validate', ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd, timeoutMs: 60_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

describe('validate command', () => {
  let dir = '';
  let dataDir = '';
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-validate-'));
    dataDir = join(dir, 'data');
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('exits 0 for a valid brief and reports its kind, absolute path and the checks that ran', async () => {
    const path = join(dir, 'brief.json');
    writeJsonAtomic(path, briefExample);
    const run = await validate([path], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.equal(run.result.ok, true);
    assert.equal(run.result.command, 'validate');
    const data = run.result.data as ValidateData;
    assert.deepEqual(data, { kind: 'brief', path, checks: 5 });
    assert.match(run.stderr, /is a valid brief document; 5 semantic check\(s\) passed/);
  });

  it('resolves a relative path against the working directory', async () => {
    writeJsonAtomic(join(dir, 'look.json'), lookBibleExample);
    const run = await validate(['look.json'], dataDir, dir);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.deepEqual(run.result.data, { kind: 'look-bible', path: join(dir, 'look.json'), checks: 4 });
  });

  it('exits 1 with code schema-validation and the instance path when the schema rejects the document', async () => {
    const path = join(dir, 'bad-schema.json');
    writeJsonAtomic(path, mutated(briefExample, (copy) => { (copy as { width: unknown }).width = 'wide'; }));
    const run = await validate([path], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.data, null);
    assert.equal(run.result.errors[0]?.code, 'schema-validation');
    assert.match(run.result.errors[0]?.message ?? '', /The brief document is invalid: \/width: must be integer/);
    assert.match(run.result.errors[0]?.hint ?? '', /schemas\/brief\.schema\.json/);
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/);
  });

  it('exits 1 with code schema-validation and the rule when a semantic check fails', async () => {
    const path = join(dir, 'bad-semantics.json');
    writeJsonAtomic(path, mutated(shotSpecExample, (copy) => { copy.width = 1921; }));
    const run = await validate([path], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'schema-validation');
    assert.match(run.result.errors[0]?.message ?? '', /The shot-spec document is invalid: width and height must be even for yuv420p; got 1921x1080/);
    assert.match(run.result.errors[0]?.hint ?? '', /src\/schema\/checks\/shot-spec\.ts/);
  });

  it('reports a subject asset missing from the ledger under the data directory, and passes once it is recorded', async () => {
    const path = join(dir, 'with-asset.json');
    writeJsonAtomic(path, mutated(briefExample, (copy) => { copy.subject.assetIds = ['font:inter']; }));
    const missing = await validate([path], dataDir);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.result.errors[0]?.message ?? '', /names asset "font:inter", which is not in the asset ledger/);
    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    for (const record of assetsLedgerExample.assets) ledger.record(record);
    ledger.save();
    const recorded = await validate([path], dataDir);
    assert.equal(recorded.exitCode, 0, recorded.stderr);
  });

  it('exits 1 with code data-file, naming assets.json, when the ledger under the data directory is malformed', async () => {
    const badDataDir = join(dir, 'bad-data');
    writeJsonAtomic(assetLedgerPath(badDataDir), { kind: 'assets-ledger', version: 2, assets: [] });
    const path = join(dir, 'with-asset-bad-ledger.json');
    writeJsonAtomic(path, mutated(briefExample, (copy) => { copy.subject.assetIds = ['font:inter']; }));
    const run = await validate([path], badDataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.errors[0]?.code, 'data-file');
    assert.match(run.result.errors[0]?.message ?? '', /Cannot read .*assets\.json: its version is 2, not 1/);
  });

  it('runs the two ledger checks on an assets-ledger document and reports checks: 2', async () => {
    const path = join(dir, 'assets-ledger.json');
    writeJsonAtomic(path, assetsLedgerExample);
    const run = await validate([path], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.deepEqual(run.result.data, { kind: 'assets-ledger', path, checks: 2 });
  });

  it('exits 1 with code schema-validation for a document of unknown kind', async () => {
    const path = join(dir, 'unknown.json');
    writeJsonAtomic(path, { kind: 'scene', version: 1 });
    const run = await validate([path], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'schema-validation');
    assert.match(run.result.errors[0]?.message ?? '', /"scene" is not a known document kind/);
  });

  it('exits 1 with code data-file for a file that does not exist', async () => {
    const run = await validate([join(dir, 'missing.json')], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.errors[0]?.code, 'data-file');
    assert.match(run.result.errors[0]?.message ?? '', /does not exist/);
  });

  it('exits 2 with a usage error when no file or more than one file is given', async () => {
    const none = await validate([], dataDir);
    assert.equal(none.exitCode, 2);
    assert.equal(none.result.errors[0]?.code, 'usage');
    assert.match(none.result.errors[0]?.message ?? '', /Missing the file to validate/);
    const two = await validate(['a.json', 'b.json'], dataDir);
    assert.equal(two.exitCode, 2);
    assert.match(two.result.errors[0]?.message ?? '', /validate takes one file, got 2/);
  });
});
