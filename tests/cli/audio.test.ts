import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { componentPaths } from '../../src/audio/component.ts';
import type { InstallNarrationResult } from '../../src/audio/install.ts';
import type { AudioStatusData } from '../../src/audio/status-command.ts';
import type { AudioVoicesData } from '../../src/audio/voices-command.ts';
import { defaultVoice, offeredVoices } from '../../src/audio/voices.ts';
import { kokoroWeightFiles } from '../../src/audio/weights.ts';
import { audioActions } from '../../src/cli/commands/audio.ts';
import type { CliResult } from '../../src/cli/result.ts';
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

async function audio(args: readonly string[], dataDir: string): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, 'audio', ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs: 60_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

describe('the audio command', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-audio-cli-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('lists its four actions', () => {
    assert.deepEqual(audioActions, ['install', 'status', 'voices', 'synth']);
  });

  it('without an action is a usage error naming the actions, exit 2, and so is an unknown action or a stray argument', async () => {
    const none = await audio([], dataDir);
    assert.equal(none.exitCode, 2);
    assert.equal(none.result.errors[0]?.code, 'usage');
    assert.match(none.result.errors[0]?.message ?? '', /audio needs an action/);
    assert.match(none.result.errors[0]?.hint ?? '', /install, status, voices, synth/);
    assert.doesNotMatch(none.stderr, /at .*\.ts:\d+/);

    const unknown = await audio(['dance'], dataDir);
    assert.equal(unknown.exitCode, 2);
    assert.match(unknown.result.errors[0]?.message ?? '', /Unknown audio action "dance"/);

    const stray = await audio(['voices', 'extra'], dataDir);
    assert.equal(stray.exitCode, 2);
    assert.match(stray.result.errors[0]?.message ?? '', /Unexpected argument "extra"/);
  });

  it('voices prints the offered voices with grades and names the default', async () => {
    const run = await audio(['voices'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as AudioVoicesData;
    assert.deepEqual(data.voices, offeredVoices);
    assert.equal(data.default, defaultVoice);
    assert.equal(data.floor, 'B-');
    assert.match(run.stderr, /^af_heart {2}A {3}american female {2}\(default\)$/m);
    assert.match(run.stderr, /4 voices graded B- or better; the default is af_heart/);
    assert.deepEqual(run.result.artifacts, []);
  });

  it('status on a fresh data directory reports the component as not installed with the ledger empty', async () => {
    const run = await audio(['status'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as AudioStatusData;
    assert.equal(data.installed, false);
    assert.equal(data.packagesPresent, false);
    assert.equal(data.lockfileHash, null);
    assert.equal(data.weightsPresent.length, kokoroWeightFiles.length);
    assert.ok(data.missing.length >= 2, data.missing.join('\n'));
    assert.deepEqual(data.ledger.map((entry) => [entry.id, entry.record]), kokoroWeightFiles.map((file) => [`narration:${file.path}`, null]));
    assert.equal(data.provenance, null);
    assert.equal(data.provenanceProblem, null);
    assert.equal(data.paths.root, componentPaths(dataDir).root);
    assert.match(run.stderr, /^narration: not installed under /m);
    assert.match(run.stderr, /^ {2}missing: the packages kokoro-js, @huggingface\/transformers are not under /m);
  });

  it('status reports a provenance file that is not JSON instead of failing', async () => {
    const corruptDir = join(dataDir, 'corrupt-provenance');
    const paths = componentPaths(corruptDir);
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.provenance, '{');
    const run = await audio(['status'], corruptDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as AudioStatusData;
    assert.equal(data.provenance, null);
    assert.match(data.provenanceProblem ?? '', /provenance\.json.*not valid JSON/);
    assert.equal(data.installed, false);
    assert.match(run.stderr, /^warning: {3}provenance: .*not valid JSON/m);
  });

  it('install without --yes exits 0 with confirmed false, the sizes, the notice and the hint, and writes nothing', async () => {
    const run = await audio(['install'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.equal(run.result.ok, true);
    const data = run.result.data as InstallNarrationResult;
    assert.equal(data.confirmed, false);
    assert.equal(data.installed, false);
    assert.equal(data.hint, 'Run again with --yes to install.');
    assert.equal(data.packages.count, 80);
    assert.equal(data.weights.length, 4);
    assert.equal(data.weights[0]?.bytes, 92_361_116);
    assert.equal(data.thirdParty.length, 3);
    assert.deepEqual(run.result.evidence, []);
    assert.match(run.stderr, /about 150 MB to download, 425 MB on disk/);
    assert.match(run.stderr, /4 model files of onnx-community\/Kokoro-82M-v1.0-ONNX at commit 1939ad2a8e41 \(Apache-2.0\): 92 MB to download/);
    assert.match(run.stderr, /eSpeak NG \(GPL-3.0-or-later, inside phonemizer 1.2.1\)/);
    assert.match(run.stderr, /Run again with --yes to install\./);
    assert.equal(existsSync(componentPaths(dataDir).root), false);
  });

  it('refuses an option it does not know', async () => {
    const run = await audio(['install', '--force'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.match(run.result.errors[0]?.message ?? '', /Unknown option --force/);
  });
});
