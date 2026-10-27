import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CliResult } from '../../src/cli/result.ts';
import { describeManifest, findMissing, laneGap, nodeMeetsMinimum, parseRequiredLanes } from '../../src/cli/commands/doctor.ts';
import { UsageError } from '../../src/errors/vision-forge-error.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { ToolsManifest } from '../../src/shared/contracts/tools.ts';
import { describeUnsupportedBlender, isSupportedBlenderVersion } from '../../src/tools/blender.ts';
import { findBrowsers } from '../../src/tools/browsers.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { requiredEncoders, requiredFilters } from '../../src/tools/ffmpeg-info.ts';
import { readToolsManifest, toolsManifestPath } from '../../src/tools/tools-manifest.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function doctor(args: readonly string[], dataDir: string): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, 'doctor', ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs: 180_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

const sampleManifest: ToolsManifest = {
  kind: 'tools',
  version: 1,
  generatedAt: '2026-10-26T20:00:00.000Z',
  platform: { os: 'win32', arch: 'x64', release: '10.0.26300' },
  node: { path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v24.13.0' },
  interactiveSession: true,
  longPathsEnabled: false,
  programs: {
    ffmpeg: { path: 'C:\\ffmpeg\\bin\\ffmpeg.exe', version: '9.0.2', filters: [...requiredFilters], encoders: [...requiredEncoders] },
    ffprobe: { path: 'C:\\ffmpeg\\bin\\ffprobe.exe', version: '9.0.2' },
  },
  browsers: [{ channel: 'msedge', path: 'C:\\Edge\\msedge.exe', version: '156.0.4314.42', webgl: null }],
  gpu: null,
  lanes: { html: true, three: false, blender: false, audio: true },
  narration: { installed: false, weightsVerified: false },
  problems: [],
};

describe('doctor helpers', () => {
  it('gates Node at 24.12', () => {
    assert.equal(nodeMeetsMinimum('v24.12.0'), true);
    assert.equal(nodeMeetsMinimum('v24.13.0'), true);
    assert.equal(nodeMeetsMinimum('v26.0.0'), true);
    assert.equal(nodeMeetsMinimum('v24.11.9'), false);
    assert.equal(nodeMeetsMinimum('v22.20.0'), false);
    assert.equal(nodeMeetsMinimum('garbage'), false);
  });

  it('parses --require and refuses unknown lanes', () => {
    assert.deepEqual(parseRequiredLanes(undefined), []);
    assert.deepEqual(parseRequiredLanes('html, three'), ['html', 'three']);
    assert.throws(() => parseRequiredLanes('html,bogus'), (error: unknown) => error instanceof UsageError && /Unknown lane "bogus"/.test(error.message));
  });

  it('lists what is missing with Blender as optional and explains each unavailable lane', () => {
    const missing = findMissing(sampleManifest, 'win32');
    assert.deepEqual(missing.map((entry) => [entry.tool, entry.required]), [['Blender 5.2 LTS', false]]);
    assert.match(missing[0]?.hint ?? '', /winget install --id BlenderFoundation\.Blender --version 5\.2\.3 --exact/);
    const nothing: ToolsManifest = { ...sampleManifest, node: { ...sampleManifest.node, version: 'v22.0.0' }, programs: {}, browsers: [], lanes: { html: false, three: false, blender: false, audio: false } };
    assert.deepEqual(findMissing(nothing, 'win32').map((entry) => entry.tool), ['Node.js 24.12 or newer', 'ffmpeg', 'ffprobe', 'a browser (Microsoft Edge or Google Chrome)', 'Blender 5.2 LTS']);
    assert.equal(laneGap(sampleManifest, 'html', 'win32'), undefined);
    assert.equal(laneGap(sampleManifest, 'blender', 'win32')?.what, 'Blender 5.2 LTS');
    assert.equal(laneGap(nothing, 'html', 'win32')?.what, 'ffmpeg');
    assert.equal(laneGap(nothing, 'audio', 'win32')?.what, 'ffmpeg with the aac and pcm_s16le encoders');
  });

  it('explains the three lane from the recorded WebGL failure before blaming --skip-browser-check', () => {
    assert.match(laneGap(sampleManifest, 'three', 'win32')?.hint ?? '', /--skip-browser-check/);
    const failure = 'msedge: the WebGL check failed: browserType.launchPersistentContext: policy blocks headless mode.';
    const failed: ToolsManifest = { ...sampleManifest, problems: [failure] };
    assert.deepEqual(laneGap(failed, 'three', 'win32'), { what: 'a browser with a WebGL2 context', hint: failure });
    const webgl1: ToolsManifest = { ...sampleManifest, browsers: [{ ...sampleManifest.browsers[0], channel: 'msedge', path: 'C:\\Edge\\msedge.exe', version: '156.0.4314.42', webgl: { renderer: 'x', vendor: 'y', webgl2: false, hardware: true, extColorBufferFloat: false } }] };
    assert.match(laneGap(webgl1, 'three', 'win32')?.hint ?? '', /without WebGL2/);
  });

  it('explains an unsupported Blender with its own sentence even when a Store refusal was recorded first', () => {
    const blender = { path: 'C:\\Old\\blender.exe', version: '4.5.15' };
    const manifest: ToolsManifest = {
      ...sampleManifest,
      programs: { ...sampleManifest.programs, blender },
      problems: ['Blender at C:\\Program Files\\WindowsApps\\x\\blender.exe (on PATH) is a Microsoft Store build, which is not supported; install it with winget or from blender.org.', describeUnsupportedBlender('4.5.15', 'C:\\Old\\blender.exe', 'win32')],
    };
    const gap = laneGap(manifest, 'blender', 'win32');
    assert.equal(gap?.what, 'Blender 5.2 LTS (found 4.5.15)');
    assert.equal(gap?.hint, describeUnsupportedBlender('4.5.15', 'C:\\Old\\blender.exe', 'win32'));
    assert.match(gap?.hint ?? '', /winget install --id BlenderFoundation\.Blender --version 5\.2\.3 --exact/);
  });

  it('describes the manifest one line per tool', () => {
    const lines = describeManifest(sampleManifest, 'win32');
    assert.ok(lines.includes('ffmpeg 9.0.2 at C:\\ffmpeg\\bin\\ffmpeg.exe'));
    assert.ok(lines.some((line) => line.startsWith('Blender: not found. Install Blender 5.2 LTS with: winget install')));
    assert.ok(lines.includes('lanes: html yes, three no, blender no, audio yes'));
  });
});

describe('doctor on this machine', () => {
  const ffmpeg = findFfmpeg();
  const browsers = findBrowsers().found;
  const skip = ffmpeg === undefined ? 'ffmpeg is not installed' : browsers.length === 0 ? 'no browser is installed' : false;
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-doctor-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('writes a valid tools.json, opens the html and three lanes and opens blender only for a supported install', { skip, timeout: 240_000 }, async () => {
    const run = await doctor(['--skip-blender-probe'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.equal(run.result.ok, true);
    const manifest = readToolsManifest(dataDir);
    assert.equal(manifest.lanes.html, true, run.stderr);
    assert.equal(manifest.lanes.three, true, run.stderr);
    const blender = manifest.programs.blender;
    assert.equal(manifest.lanes.blender, blender !== undefined && isSupportedBlenderVersion(blender.version));
    assert.match(manifest.programs.ffmpeg?.version ?? '', /^\d+\.\d+/, manifest.programs.ffmpeg?.version);
    assert.ok(manifest.browsers.length >= 1);
    for (const browser of manifest.browsers) {
      if (browser.webgl === null) {
        assert.ok(manifest.problems.some((problem) => problem.startsWith(`${browser.channel}: the WebGL check failed`)), `${browser.channel} has no WebGL report and no problem sentence`);
      } else {
        assert.equal(browser.webgl.webgl2, true);
      }
      assert.match(browser.version, /^\d+\.\d+\.\d+\.\d+$/);
      assert.equal(existsSync(join(dataDir, 'profiles', `doctor-${browser.channel}`)), false, 'the profile was removed');
    }
    assert.ok(manifest.browsers.some((browser) => browser.webgl?.webgl2 === true), manifest.problems.join('\n'));
    const data = run.result.data as { readonly lanes: ToolsManifest['lanes']; readonly missing: readonly { readonly tool: string; readonly required: boolean }[]; readonly manifestPath: string };
    assert.deepEqual(data.lanes, manifest.lanes);
    assert.equal(data.manifestPath, toolsManifestPath(dataDir));
    assert.ok(data.missing.every((entry) => !entry.required), JSON.stringify(data.missing));
    assert.match(run.stderr, /^ffmpeg \d+\./m);
    assert.match(run.stderr, /^lanes: html yes, three yes, blender (yes|no), audio yes$/m);
  });

  it('records null WebGL reports and no three lane with --skip-browser-check', { skip, timeout: 120_000 }, async () => {
    const run = await doctor(['--skip-browser-check', '--skip-blender-probe'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const manifest = readToolsManifest(dataDir);
    assert.ok(manifest.browsers.every((browser) => browser.webgl === null));
    assert.equal(manifest.lanes.three, false);
  });

  it('exits 1 naming the blender lane when --require blender cannot be met', { skip, timeout: 120_000 }, async () => {
    const run = await doctor(['--require', 'blender', '--skip-browser-check', '--skip-blender-probe'], dataDir);
    if (readToolsManifest(dataDir).lanes.blender) return;
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.ok, false);
    assert.equal(run.result.errors[0]?.code, 'tool-missing');
    assert.match(run.result.errors[0]?.message ?? '', /blender lane/);
    assert.match(run.result.errors[0]?.hint ?? '', /Blender 5\.2 LTS|5\.2\.3/);
    assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/);
  });

  it('refuses an unknown lane in --require with a usage error', { timeout: 120_000 }, async () => {
    const run = await doctor(['--require', 'bogus', '--skip-browser-check', '--skip-blender-probe'], dataDir);
    assert.equal(run.exitCode, 2);
    assert.match(run.result.errors[0]?.message ?? '', /Unknown lane "bogus"/);
  });
});
