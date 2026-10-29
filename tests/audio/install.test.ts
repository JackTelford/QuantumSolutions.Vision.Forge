import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { corruptPath } from '../../src/assets/fetch.ts';
import { componentPaths, componentStatus, narrationPackages, packageJsonPath } from '../../src/audio/component.ts';
import { findNpmCli, installNarration, kokoroCredit, licenseText, npmTimeoutMs } from '../../src/audio/install.ts';
import type { InstallNarrationOptions, NarrationProvenance } from '../../src/audio/install.ts';
import { narrationThirdPartyNotices } from '../../src/audio/third-party.ts';
import { kokoroCommit, kokoroWeightAssetId, kokoroWeightDestination } from '../../src/audio/weights.ts';
import type { PinnedWeightFile } from '../../src/audio/weights.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { NpmInstallFailedError, NpmMissingError, WeightsDownloadFailedError } from '../../src/errors/narration-errors.ts';
import { CancelledError } from '../../src/errors/vision-forge-error.ts';
import type { AllowedHost } from '../../src/net/allowlist.ts';
import { AssetLedger, assetLedgerPath } from '../../src/net/asset-ledger.ts';
import { HttpDownloader } from '../../src/net/http-downloader.ts';
import type { ProcessSpec } from '../../src/process/process-runner.ts';
import { npmCliCandidates } from '../../src/tools/npm-cli.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { LoopbackServer } from '../fakes/loopback-server.ts';

const loopbackAllowlist: readonly AllowedHost[] = [{ host: '127.0.0.1', redirectHosts: [], purpose: 'tests' }];
const never = new AbortController().signal;
const fixedNow = new Date('2026-10-29T12:00:00Z');
/** The running Node's file name (node.exe here, node elsewhere), which the fake runner matches on. */
const nodeName = basename(process.execPath);

/** Repeatable bytes so the hashes in assertions are stable. */
function deterministicBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out[index] = state & 0xff;
  }
  return out;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Four small stand-ins for the pinned files, with the real paths. */
const bodies: ReadonlyMap<string, Buffer> = new Map([
  ['onnx/model_quantized.onnx', deterministicBytes(64 * 1024, 3)],
  ['config.json', Buffer.from('{"model_type":"kokoro"}')],
  ['tokenizer.json', deterministicBytes(3_497, 5)],
  ['tokenizer_config.json', deterministicBytes(113, 7)],
]);
const files: readonly PinnedWeightFile[] = [...bodies].map(([path, body]) => ({ path, bytes: body.length, sha256: sha256(body) }));

/** The fake npm: writes the two package.json files a real `npm ci` leaves behind, and the hidden lockfile it writes last. */
function fakeNpmInstall(spec: ProcessSpec): void {
  for (const name of narrationPackages) {
    const path = join(spec.cwd ?? '', 'node_modules', ...name.split('/'), 'package.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `{ "name": "${name}" }\n`);
  }
  writeFileSync(join(spec.cwd ?? '', 'node_modules', '.package-lock.json'), '{ "lockfileVersion": 3 }\n');
}

describe('installNarration', () => {
  const server = new LoopbackServer();
  let dir = '';

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-install-'));
    for (const [path, body] of bodies) server.serveFile(`/${path}`, body);
    await server.start();
  });

  after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  function make(dataDir: string, overrides: Partial<InstallNarrationOptions> = {}): { readonly options: InstallNarrationOptions; readonly runner: FakeProcessRunner; readonly log: MemoryLogger } {
    const log = new MemoryLogger();
    const runner = new FakeProcessRunner();
    const downloader = new HttpDownloader({ allowlist: loopbackAllowlist, userAgent: 'vision-forge-test/0.0.0', log, now: () => fixedNow });
    const options: InstallNarrationOptions = {
      dataDir, runner, log, signal: never, now: () => fixedNow, confirm: true, files, urlOf: (file) => server.urlFor(`/${file.path}`), downloader, ...overrides,
    };
    return { options, runner, log };
  }

  it('without confirmation prints the sizes and the notice, runs nothing, fetches nothing and says to run again with --yes', async () => {
    const dataDir = join(dir, 'unconfirmed');
    const { options, runner, log } = make(dataDir, { confirm: false });
    const requestsBefore = server.requests.length;
    const result = await installNarration(options);
    assert.equal(result.confirmed, false);
    assert.equal(result.installed, false);
    assert.equal(result.hint, 'Run again with --yes to install.');
    assert.equal(result.provenancePath, null);
    assert.equal(result.packages.installedNow, false);
    assert.equal(result.packages.count, 80, 'the lockfile template lists 80 packages beside the root');
    assert.match(result.packages.lockfileSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(result.weights.map((weight) => weight.downloaded), [false, false, false, false]);
    assert.deepEqual(result.thirdParty, narrationThirdPartyNotices);
    assert.equal(runner.invocations.length, 0);
    assert.equal(server.requests.length, requestsBefore);
    assert.equal(existsSync(componentPaths(dataDir).root), false, 'nothing is written before confirmation');
    assert.ok(log.messages.some((message) => /150 MB to download, 425 MB on disk/.test(message)), log.messages.join('\n'));
    assert.ok(log.messages.some((message) => /eSpeak NG \(GPL-3.0-or-later/.test(message)));
    assert.ok(log.messages.some((message) => /libvips \(LGPL-3.0-or-later/.test(message)));
    assert.ok(log.messages.some((message) => /DirectML.dll \(Proprietary/.test(message)));
    assert.ok(log.messages.includes('info: Run again with --yes to install.'));
  });

  it('runs node with npm-cli.js ci --ignore-scripts --no-audit --no-fund in <data>/narration with the notifier off, then downloads, records and describes the weights', async () => {
    const dataDir = join(dir, 'fresh');
    const { options, runner, log } = make(dataDir);
    const npmCli = findNpmCli(process.execPath, process.platform);
    runner.expect(matchProgram(nodeName), okResult('added 55 packages in 6s'), fakeNpmInstall);
    const result = await installNarration(options);
    const paths = componentPaths(dataDir);

    // The argv golden.
    assert.equal(runner.invocations.length, 1);
    const spec = runner.invocations[0]!;
    assert.equal(spec.executable, process.execPath);
    assert.deepEqual(spec.args, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(spec.cwd, paths.root);
    assert.deepEqual(spec.env, { npm_config_update_notifier: 'false' });
    assert.equal(spec.timeoutMs, npmTimeoutMs);
    assert.equal(spec.label, 'npm');

    // The template was copied before npm ran.
    assert.ok(readFileSync(paths.lockfile).equals(readFileSync(join(import.meta.dirname, '..', '..', 'components', 'narration', 'package-lock.json'))));
    assert.ok(readFileSync(paths.packageJson, 'utf8').includes('"kokoro-js": "1.2.1"'));

    assert.equal(result.confirmed, true);
    assert.equal(result.installed, true);
    assert.equal(result.packages.installedNow, true);
    assert.deepEqual(result.weights, files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256, downloaded: true, verified: 'downloaded' })));
    for (const file of files) assert.ok(readFileSync(kokoroWeightDestination(dataDir, file)).equals(bodies.get(file.path)!));

    // The ledger records.
    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    ledger.load();
    const model = files[0]!;
    assert.deepEqual(ledger.find(kokoroWeightAssetId(model)), {
      id: 'narration:onnx/model_quantized.onnx',
      source: server.urlFor('/onnx/model_quantized.onnx'),
      finalUrl: server.urlFor('/onnx/model_quantized.onnx'),
      license: 'Apache-2.0',
      bytes: model.bytes,
      sha256: model.sha256,
      fetchedAt: '2026-10-29T12:00:00.000Z',
      credit: kokoroCredit,
      files: ['narration/models/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx'],
    });
    assert.equal(ledger.all().length, 4);

    // The license note and the provenance file.
    assert.equal(readFileSync(paths.license, 'utf8'), licenseText());
    assert.ok(licenseText().includes('Apache-2.0') && licenseText().includes('https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX'));
    assert.equal(result.provenancePath, paths.provenance);
    const provenance = JSON.parse(readFileSync(paths.provenance, 'utf8')) as NarrationProvenance;
    assert.equal(provenance.kind, 'narration-provenance');
    assert.equal(provenance.commit, kokoroCommit);
    assert.deepEqual(provenance.files, files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })));
    assert.equal(provenance.packages.lockfileSha256, result.packages.lockfileSha256);
    assert.equal(provenance.packages.count, 80);
    assert.equal(provenance.fetchedAt, '2026-10-29T12:00:00.000Z');
    assert.equal(provenance.nodeVersion, process.version);
    assert.equal(provenance.licensePath, paths.license);
    assert.ok(log.messages.some((message) => /the one npm call|running .*npm-cli\.js ci/.test(message)));
    assert.equal(componentStatus(dataDir, files).installed, true);
  });

  it('on a second run skips npm (same lockfile, packages present) and every weight (right size, ledger hash), touching the network not at all', async () => {
    const dataDir = join(dir, 'fresh');
    const { options, runner, log } = make(dataDir);
    const requestsBefore = server.requests.length;
    const result = await installNarration(options);
    assert.equal(runner.invocations.length, 0);
    assert.equal(server.requests.length, requestsBefore);
    assert.equal(result.packages.installedNow, false);
    assert.deepEqual(result.weights.map((weight) => weight.downloaded), [false, false, false, false]);
    assert.deepEqual(result.weights.map((weight) => weight.verified), ['ledger', 'ledger', 'ledger', 'ledger']);
    assert.equal(result.installed, true);
    assert.ok(log.messages.some((message) => /packages: already installed/.test(message)));
    assert.ok(log.messages.some((message) => /config\.json: already installed \(\d+ bytes, recorded in the ledger\)/.test(message)));
  });

  it('with --verify re-hashes a present file, keeps a good one and sets a wrong one aside as .corrupt before downloading it again', async () => {
    const dataDir = join(dir, 'fresh');
    const tokenizer = files[2]!;
    const path = kokoroWeightDestination(dataDir, tokenizer);
    const tampered = Buffer.from(bodies.get(tokenizer.path)!);
    tampered[10] = (tampered[10] ?? 0) ^ 0xff;
    writeFileSync(path, tampered);
    const { options, runner, log } = make(dataDir, { verify: true });
    const requestsBefore = server.requests.length;
    const result = await installNarration(options);
    assert.equal(runner.invocations.length, 0);
    assert.equal(server.requests.length - requestsBefore, 1, 'only the tampered file is fetched');
    assert.deepEqual(result.weights.map((weight) => weight.downloaded), [false, false, true, false]);
    assert.deepEqual(result.weights.map((weight) => weight.verified), ['rehashed', 'rehashed', 'downloaded', 'rehashed'], 'the result says which hashes came from a re-hash');
    assert.ok(readFileSync(path).equals(bodies.get(tokenizer.path)!));
    assert.ok(readFileSync(corruptPath(path)).equals(tampered), 'the wrong bytes are kept beside the file');
    assert.ok(log.messages.some((message) => message.startsWith(`warn: tokenizer.json: sha256 ${sha256(tampered)} differs from the pinned ${tokenizer.sha256}; moved it to ${corruptPath(path)}`)), log.messages.join('\n'));
    assert.ok(log.messages.some((message) => /config\.json: already installed, sha256 verified/.test(message)));
  });

  it('re-hashes a present file the ledger does not vouch for and records it without a download', async () => {
    const dataDir = join(dir, 'fresh');
    rmSync(assetLedgerPath(dataDir));
    const { options } = make(dataDir);
    const requestsBefore = server.requests.length;
    const result = await installNarration(options);
    assert.equal(server.requests.length, requestsBefore);
    assert.deepEqual(result.weights.map((weight) => weight.verified), ['rehashed', 'rehashed', 'rehashed', 'rehashed']);
    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    ledger.load();
    assert.equal(ledger.all().length, 4, 'the records are written back');
  });

  it('runs npm again when the package.json markers stand without npm\'s hidden lockfile, as after a killed npm ci', async () => {
    const dataDir = join(dir, 'fresh');
    const paths = componentPaths(dataDir);
    rmSync(paths.hiddenLockfile);
    assert.equal(componentStatus(dataDir, files).packagesPresent, false);
    const { options, runner, log } = make(dataDir);
    runner.expect(matchProgram(nodeName), okResult(), fakeNpmInstall);
    const result = await installNarration(options);
    assert.equal(runner.invocations.length, 1);
    assert.equal(result.packages.installedNow, true);
    assert.equal(result.installed, true);
    assert.ok(log.messages.every((message) => !/packages: already installed/.test(message)), log.messages.join('\n'));
  });

  it('sets aside a present file of the wrong size and downloads it again', async () => {
    const dataDir = join(dir, 'fresh');
    const config = files[1]!;
    const path = kokoroWeightDestination(dataDir, config);
    writeFileSync(path, 'short');
    const { options, log } = make(dataDir);
    const result = await installNarration(options);
    assert.deepEqual(result.weights.map((weight) => weight.downloaded), [false, true, false, false]);
    assert.equal(readFileSync(corruptPath(path), 'utf8'), 'short');
    assert.ok(log.messages.some((message) => /warn: config\.json: 5 bytes on disk, not the pinned 23/.test(message)));
  });

  it('runs npm again when the copied lockfile differs from the template', async () => {
    const dataDir = join(dir, 'fresh');
    const paths = componentPaths(dataDir);
    writeFileSync(paths.lockfile, '{}');
    const { options, runner } = make(dataDir);
    runner.expect(matchProgram(nodeName), okResult(), fakeNpmInstall);
    const result = await installNarration(options);
    assert.equal(runner.invocations.length, 1);
    assert.equal(result.packages.installedNow, true);
    assert.equal(componentStatus(dataDir, files).lockfileMatches, true, 'the template was copied over the stale file');
  });

  it('fails with npm-install-failed and the stderr tail when npm exits non-zero, leaving the component not installed', async () => {
    const dataDir = join(dir, 'npm-fails');
    const { options, runner } = make(dataDir);
    runner.expect(matchProgram(nodeName), failedResult(1, 'npm error code ETARGET\nnpm error notarget No matching version found for kokoro-js@1.2.1.\n'));
    await assert.rejects(installNarration(options), (error: unknown) => error instanceof NpmInstallFailedError
      && error.code === 'npm-install-failed'
      && /npm ci exited with code 1\. Last output: npm error code ETARGET npm error notarget/.test(error.message)
      && /registry\.npmjs\.org/.test(error.hint));
    assert.equal(componentStatus(dataDir, files).installed, false);
    assert.equal(existsSync(componentPaths(dataDir).lockfile), true, 'the lockfile copy stays so the next run tries npm again');
  });

  it('fails with npm-install-failed when npm times out, and when it exits 0 without the packages', async () => {
    const dataDir = join(dir, 'npm-timeout');
    const { options, runner } = make(dataDir);
    runner.expect(matchProgram(nodeName), { exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '', elapsedMs: npmTimeoutMs, timedOut: true });
    await assert.rejects(installNarration(options), (error: unknown) => error instanceof NpmInstallFailedError && /did not finish within 600 s/.test(error.message));

    const empty = make(join(dir, 'npm-empty'));
    empty.runner.expect(matchProgram(nodeName), okResult());
    await assert.rejects(installNarration(empty.options), (error: unknown) => error instanceof NpmInstallFailedError && /exited 0 but the packages kokoro-js, @huggingface\/transformers are not under/.test(error.message));
  });

  it('fails with npm-missing naming the path tried when npm-cli.js is not beside the Node given', async () => {
    const dataDir = join(dir, 'npm-missing');
    const fakeNode = join(dir, 'no-npm-here', 'node.exe');
    const { options, runner } = make(dataDir, { execPath: fakeNode, platform: 'win32' });
    await assert.rejects(installNarration(options), (error: unknown) => error instanceof NpmMissingError
      && error.code === 'npm-missing'
      && error.message.includes(npmCliCandidates(fakeNode, 'win32')[0] ?? '')
      && /nodejs\.org/.test(error.hint));
    assert.equal(runner.invocations.length, 0);
  });

  it('finds npm-cli.js under npm/bin beside the running Node on this machine', () => {
    const found = findNpmCli(process.execPath, process.platform);
    assert.ok(found.endsWith(join('npm', 'bin', 'npm-cli.js')), found);
    assert.ok(existsSync(found), found);
  });

  it('fails with weights-download-failed naming the file and keeping the downloader\'s sentence when a pinned URL answers 404', async () => {
    const dataDir = join(dir, 'weights-404');
    server.answer('/missing/tokenizer_config.json', 404, 'gone');
    const { options, runner } = make(dataDir, { urlOf: (file) => server.urlFor(file.path === 'tokenizer_config.json' ? '/missing/tokenizer_config.json' : `/${file.path}`) });
    runner.expect(matchProgram(nodeName), okResult(), fakeNpmInstall);
    await assert.rejects(installNarration(options), (error: unknown) => error instanceof WeightsDownloadFailedError
      && error.code === 'weights-download-failed'
      && error.file === 'tokenizer_config.json'
      && /The pinned model file tokenizer_config\.json could not be downloaded: tokenizer_config\.json: could not download .*: the server answered 404\./.test(error.message)
      && /pinned URL no longer exists/.test(error.hint));
    const ledger = new AssetLedger(assetLedgerPath(dataDir));
    ledger.load();
    assert.equal(ledger.all().length, 3, 'the three files before it are recorded; the failed one is not');
    assert.equal(existsSync(componentPaths(dataDir).provenance), false, 'no provenance without every file');
    assert.equal(componentStatus(dataDir, files).installed, false);
  });

  it('fails with weights-download-failed on a hash that does not match the pin, keeping nothing of the file', async () => {
    const dataDir = join(dir, 'weights-hash');
    const wrongPin: readonly PinnedWeightFile[] = files.map((file, index) => (index === 0 ? { ...file, sha256: 'f'.repeat(64) } : file));
    const { options, runner } = make(dataDir, { files: wrongPin });
    runner.expect(matchProgram(nodeName), okResult(), fakeNpmInstall);
    await assert.rejects(installNarration(options), (error: unknown) => error instanceof WeightsDownloadFailedError && /wrong sha256/.test(error.message));
    assert.equal(existsSync(kokoroWeightDestination(dataDir, wrongPin[0]!)), false);
  });

  it('stops with cancelled between files when the signal is aborted', async () => {
    const dataDir = join(dir, 'cancelled');
    const controller = new AbortController();
    const { options, runner } = make(dataDir, { signal: controller.signal });
    runner.expect(matchProgram(nodeName), okResult(), (spec) => { fakeNpmInstall(spec); controller.abort(); });
    await assert.rejects(installNarration(options), (error: unknown) => error instanceof CancelledError);
    assert.equal(existsSync(kokoroWeightDestination(dataDir, files[0]!)), false);
  });
});
