import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { catalogue, catalogueIds } from '../../src/assets/catalogue.ts';
import { assetPath, corruptPath } from '../../src/assets/fetch.ts';
import { formatMegabytes, parseFetchIds, selectEntries } from '../../src/cli/commands/assets.ts';
import type { AssetsData } from '../../src/cli/commands/assets.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { UsageError } from '../../src/errors/vision-forge-error.ts';
import { AssetLedger, assetLedgerPath } from '../../src/net/asset-ledger.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function assets(args: readonly string[], dataDir: string): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, 'assets', ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs: 60_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

describe('assets helpers', () => {
  it('formats bytes as megabytes with one decimal', () => {
    assert.equal(formatMegabytes(1615248), '1.6 MB');
    assert.equal(formatMegabytes(6312947), '6.3 MB');
    assert.equal(formatMegabytes(0), '0.0 MB');
  });

  it('parses --fetch ids once each and refuses unknown ones naming the known ids', () => {
    assert.deepEqual(parseFetchIds('hdri:moonless_golf-1k, hdri:studio_small_09-1k,hdri:moonless_golf-1k').map((entry) => entry.id), ['hdri:moonless_golf-1k', 'hdri:studio_small_09-1k']);
    assert.throws(() => parseFetchIds('hdri:nope-1k,hdri:studio_small_09-1k'), (error: unknown) => error instanceof UsageError && /Unknown asset id "hdri:nope-1k"/.test(error.message) && error.hint.includes('hdri:studio_small_09-1k'));
    assert.throws(() => parseFetchIds(' , '), (error: unknown) => error instanceof UsageError && /names no asset/.test(error.message));
  });

  it('selects --all plus --fetch together in catalogue order', () => {
    assert.deepEqual(selectEntries(undefined, true).map((entry) => entry.id), catalogueIds());
    assert.deepEqual(selectEntries('hdri:moonless_golf-2k,hdri:studio_small_09-1k', false).map((entry) => entry.id), ['hdri:studio_small_09-1k', 'hdri:moonless_golf-2k']);
    assert.deepEqual(selectEntries('hdri:moonless_golf-2k', true).map((entry) => entry.id), catalogueIds());
  });
});

describe('the assets command', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-assets-cli-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('lists the ten catalogue entries, none installed, on a fresh data directory', async () => {
    const run = await assets([], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as AssetsData;
    assert.equal(data.assets?.length, 10);
    assert.deepEqual(data.assets?.map((asset) => asset.id), catalogueIds());
    assert.ok(data.assets?.every((asset) => !asset.installed && asset.kind === 'hdri' && asset.license === 'CC0-1.0' && asset.bytes > 0 && asset.file.startsWith(dataDir)));
    assert.equal(data.fetched, undefined);
    assert.match(run.stderr, /^hdri:studio_small_09-1k {2}1\.6 MB {2}installed: no$/m);
    assert.deepEqual(run.result.artifacts, []);
    const explicit = await assets(['--list'], dataDir);
    assert.equal(explicit.exitCode, 0);
    assert.deepEqual((explicit.result.data as AssetsData).assets, data.assets);
  });

  it('refuses an unknown --fetch id with a usage error that lists the known ids', async () => {
    const run = await assets(['--fetch', 'hdri:bogus-1k'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.errors[0]?.code, 'usage');
    assert.match(run.result.errors[0]?.message ?? '', /Unknown asset id "hdri:bogus-1k"/);
    assert.ok(run.result.errors[0]?.hint.includes('hdri:studio_small_09-1k'));
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/);
    assert.equal(existsSync(join(dataDir, 'assets.json')), false, 'nothing was written');
  });

  it('verifies an empty ledger with exit 0 and no entries', async () => {
    const run = await assets(['--verify'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.deepEqual((run.result.data as AssetsData).verified, []);
  });

  it('writes CREDITS.md under --out by default and at the given path with --credits-path <path>', async () => {
    const run = await assets(['--credits'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const expected = join(dataDir, 'out', 'CREDITS.md');
    assert.equal((run.result.data as AssetsData).credits, expected);
    assert.deepEqual(run.result.artifacts, [expected]);
    const text = readFileSync(expected, 'utf8');
    assert.ok(text.startsWith('# Credits\n'));
    assert.ok(text.includes('| Inter | Inter.ttf |'));
    assert.ok(text.includes('No assets have been downloaded.'));

    const custom = join(dataDir, 'elsewhere', 'CREDITS.md');
    const given = await assets(['--credits-path', custom], dataDir);
    assert.equal(given.exitCode, 0, given.stderr);
    assert.deepEqual(given.result.artifacts, [custom]);
    assert.equal(readFileSync(custom, 'utf8'), text);
    assert.equal((given.result.data as AssetsData).assets, undefined, '--credits-path alone is an action, not a request for the list');

    const equals = await assets([`--credits-path=${custom}`, '--credits'], dataDir);
    assert.equal(equals.exitCode, 0, equals.stderr);
    assert.deepEqual(equals.result.artifacts, [custom]);
  });

  it('refuses a stray positional, naming --credits-path for the credits file', async () => {
    const run = await assets(['--list', 'extra'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.match(run.result.errors[0]?.message ?? '', /Unexpected argument "extra"/);
    assert.match(run.result.errors[0]?.hint ?? '', /--credits-path <path>/);
    const after = await assets(['--credits', 'somewhere.md'], dataDir);
    assert.equal(after.exitCode, 2);
    assert.match(after.result.errors[0]?.message ?? '', /Unexpected argument "somewhere.md"/);
  });
});

describe('the assets command on a seeded data directory', () => {
  const entry = catalogue.find((candidate) => candidate.id === 'hdri:studio_small_09-1k');
  assert.ok(entry !== undefined);
  // The pinned size with made-up bytes: isInstalled checks the ledger md5 and the size, so nothing is downloaded.
  const bytes = Buffer.alloc(entry.bytes, 7);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let dataDir = '';
  let path = '';

  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'vf-assets-seeded-'));
    path = assetPath(dataDir, entry);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    ledger.record({ id: entry.id, source: entry.url, finalUrl: entry.url, license: entry.license, bytes: entry.bytes, sha256, md5: entry.md5, fetchedAt: '2026-10-29T12:00:00.000Z', credit: entry.credit, files: [entry.file] });
    ledger.save();
  });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('lists the seeded asset as installed and answers --fetch for it without a download', async () => {
    const listed = await assets([], dataDir);
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.match(listed.stderr, /^hdri:studio_small_09-1k {2}1\.6 MB {2}installed: yes$/m);
    assert.equal((listed.result.data as AssetsData).assets?.filter((asset) => asset.installed).map((asset) => asset.id).join(), entry.id);

    const fetched = await assets(['--fetch', entry.id], dataDir);
    assert.equal(fetched.exitCode, 0, fetched.stderr);
    assert.deepEqual((fetched.result.data as AssetsData).fetched, [{ id: entry.id, downloaded: false, path, sha256 }]);
    assert.deepEqual(fetched.result.artifacts, [path]);
    assert.match(fetched.stderr, /already installed at /);
  });

  it('verifies the seeded asset as ok, and --list combined with --verify reflects that', async () => {
    const run = await assets(['--verify', '--list'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as AssetsData;
    assert.deepEqual(data.verified?.map((asset) => [asset.id, asset.ok]), [[entry.id, true]]);
    assert.ok(data.assets?.some((asset) => asset.id === entry.id && asset.installed));
  });

  it('fails --verify with asset-integrity on a changed byte, moves the file aside and no longer lists it as installed', async () => {
    const tampered = Buffer.from(bytes);
    tampered[100] = (tampered[100] ?? 0) ^ 0xff;
    writeFileSync(path, tampered);
    const run = await assets(['--verify'], dataDir);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.errors[0]?.code, 'asset-integrity');
    assert.match(run.result.errors[0]?.message ?? '', /1 installed asset differs from the ledger: hdri:studio_small_09-1k\./);
    assert.ok(run.result.errors[0]?.hint.includes(`assets --fetch ${entry.id}`), run.result.errors[0]?.hint);
    assert.ok(run.result.errors[0]?.hint.includes(corruptPath(path)), run.result.errors[0]?.hint);
    assert.match(run.stderr, /^hdri:studio_small_09-1k: FAILED: .* hashes to sha256 /m);
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/, 'no stack trace');
    assert.equal(existsSync(path), false, 'the failed file is gone from its place');
    assert.ok(readFileSync(corruptPath(path)).equals(tampered), 'and kept beside it');

    // The repair: the asset is no longer installed, so the next --fetch would download instead of answering "already installed".
    const listed = await assets([], dataDir);
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.match(listed.stderr, /^hdri:studio_small_09-1k {2}1\.6 MB {2}installed: no$/m);
    const verified = await assets(['--verify'], dataDir);
    assert.equal(verified.exitCode, 1);
    assert.match(verified.result.errors[0]?.message ?? '', /differs from the ledger/);
    assert.match(verified.stderr, /FAILED: .* does not exist/);
    assert.doesNotMatch(verified.result.errors[0]?.hint ?? '', /moved to/, 'nothing left to move');
  });
});
