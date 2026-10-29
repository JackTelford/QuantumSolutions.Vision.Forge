import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { componentPaths, narrationPackages, narrationTemplateDir, packageJsonPath } from '../../src/audio/component.ts';
import { kokoroWeightDestination, kokoroWeightFiles } from '../../src/audio/weights.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { DataFileError, SchemaValidationError } from '../../src/errors/vision-forge-error.ts';
import type { Browser, FfmpegProgram, ToolsManifest } from '../../src/shared/contracts/tools.ts';
import { blenderProbeArgs } from '../../src/tools/blender-probe.ts';
import type { CapabilityCheck, WebglReport } from '../../src/tools/browser-capabilities.ts';
import { requiredEncoders, requiredFilters, sheetFilters } from '../../src/tools/ffmpeg-info.ts';
import { buildToolsManifest, computeLanes, describeFailedWebglCheck, describeSoftwareRenderer, ffmpegComplete, narrationState, operatingSystem, readToolsManifest, toolsManifestPath, writeToolsManifest } from '../../src/tools/tools-manifest.ts';
import type { CapabilityReader, ManifestContext } from '../../src/tools/tools-manifest.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

/** A file of exactly the given number of zero bytes, the way the status reads a weight (by size). */
function touchBytes(path: string, bytes: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes));
}

function touch(path: string, content = ''): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return path;
}

const fullFfmpeg: FfmpegProgram = { path: 'C:\\ffmpeg\\bin\\ffmpeg.exe', version: '9.0.2', filters: [...requiredFilters, ...sheetFilters], encoders: [...requiredEncoders] };
const ffprobe = { path: 'C:\\ffmpeg\\bin\\ffprobe.exe', version: '9.0.2' };
const edgeHardware: Browser = { channel: 'msedge', path: 'C:\\Edge\\msedge.exe', version: '156.0.4314.42', webgl: { renderer: 'ANGLE (NVIDIA ...)', vendor: 'Google Inc. (NVIDIA)', webgl2: true, hardware: true, extColorBufferFloat: true } };
const edgeUnchecked: Browser = { channel: 'msedge', path: 'C:\\Edge\\msedge.exe', version: '156.0.4314.42', webgl: null };
const swiftShader: WebglReport = { renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', vendor: 'Google Inc. (Google)', webgl2: true, hardware: false, extColorBufferFloat: true };
const probeLine = 'PROBE {"version_string": "5.2.3 LTS", "python": "3.13.5", "engines": ["BLENDER_EEVEE", "CYCLES"], "compute_types": ["NONE", "OPTIX"], "devices": [["NVIDIA GeForce RTX 2060", "OPTIX"], ["CPU", "CPU"]], "action_slots": true, "media_type": true}\n';

/** A capability reader that answers the same thing for every browser. */
function constantReader(check: CapabilityCheck): CapabilityReader {
  return () => Promise.resolve(check);
}

function contextFor(dataDir: string, runner: FakeProcessRunner, log = new MemoryLogger()): ManifestContext {
  return { dataDir, runner, signal: never, log, now: () => new Date('2026-10-26T20:00:00.000Z') };
}

describe('computeLanes', () => {
  it('opens every lane when everything is present and the browser reports WebGL2', () => {
    assert.deepEqual(computeLanes({ ffmpeg: fullFfmpeg, ffprobe, browsers: [edgeHardware], blender: { supported: true, probeFailed: false } }), { html: true, three: true, blender: true, audio: true });
  });

  it('needs ffmpeg, ffprobe and a browser for html, and WebGL2 for three', () => {
    assert.deepEqual(computeLanes({ ffmpeg: fullFfmpeg, ffprobe, browsers: [edgeUnchecked], blender: undefined }), { html: true, three: false, blender: false, audio: true });
    assert.deepEqual(computeLanes({ ffmpeg: fullFfmpeg, ffprobe: undefined, browsers: [edgeHardware], blender: undefined }), { html: false, three: false, blender: false, audio: true });
    assert.deepEqual(computeLanes({ ffmpeg: fullFfmpeg, ffprobe, browsers: [], blender: undefined }), { html: false, three: false, blender: false, audio: true });
    assert.deepEqual(computeLanes({ ffmpeg: undefined, ffprobe, browsers: [edgeHardware], blender: { supported: true, probeFailed: false } }), { html: false, three: false, blender: false, audio: false });
  });

  it('closes every video lane when ffmpeg lacks a required filter, but audio only when aac or pcm_s16le is missing', () => {
    const cut = { ...fullFfmpeg, filters: requiredFilters.filter((name) => name !== 'xfade') };
    assert.equal(ffmpegComplete(cut), false);
    assert.deepEqual(computeLanes({ ffmpeg: cut, ffprobe, browsers: [edgeHardware], blender: { supported: true, probeFailed: false } }), { html: false, three: false, blender: false, audio: true });
    const noAac = { ...fullFfmpeg, encoders: ['libx264', 'pcm_s16le'] };
    assert.deepEqual(computeLanes({ ffmpeg: noAac, ffprobe, browsers: [edgeHardware], blender: undefined }).audio, false);
  });

  it('closes the blender lane for an unsupported version or a failed probe', () => {
    assert.equal(computeLanes({ ffmpeg: fullFfmpeg, ffprobe, browsers: [], blender: { supported: false, probeFailed: false } }).blender, false);
    assert.equal(computeLanes({ ffmpeg: fullFfmpeg, ffprobe, browsers: [], blender: { supported: true, probeFailed: true } }).blender, false);
    assert.equal(computeLanes({ ffmpeg: fullFfmpeg, ffprobe, browsers: [], blender: { supported: true, probeFailed: false } }).blender, true);
  });
});

describe('narrationState and operatingSystem', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-narration-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('reports the component installed once npm finished, and the weights verified once the lockfile matches and every pinned file has its size', () => {
    assert.deepEqual(narrationState(dataDir), { installed: false, weightsVerified: false });
    for (const name of narrationPackages) touch(packageJsonPath(dataDir, name), '{}');
    assert.deepEqual(narrationState(dataDir), { installed: false, weightsVerified: false }, 'two markers without the hidden lockfile are an unfinished npm ci');
    touch(componentPaths(dataDir).hiddenLockfile, '{ "lockfileVersion": 3 }\n');
    assert.deepEqual(narrationState(dataDir), { installed: true, weightsVerified: false });
    copyFileSync(join(narrationTemplateDir, 'package-lock.json'), componentPaths(dataDir).lockfile);
    for (const file of kokoroWeightFiles) touchBytes(kokoroWeightDestination(dataDir, file), file.bytes === 92_361_116 ? 0 : file.bytes);
    assert.deepEqual(narrationState(dataDir), { installed: true, weightsVerified: false }, 'a model file of the wrong size is not verified');
    touchBytes(kokoroWeightDestination(dataDir, kokoroWeightFiles[0]!), kokoroWeightFiles[0]!.bytes);
    assert.deepEqual(narrationState(dataDir), { installed: true, weightsVerified: true });
  });

  it('maps every platform onto the schema vocabulary', () => {
    assert.equal(operatingSystem('win32'), 'win32');
    assert.equal(operatingSystem('darwin'), 'darwin');
    assert.equal(operatingSystem('linux'), 'linux');
    assert.equal(operatingSystem('freebsd'), 'linux');
  });
});

describe('writeToolsManifest and readToolsManifest', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-manifest-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  const manifest: ToolsManifest = {
    kind: 'tools',
    version: 1,
    generatedAt: '2026-10-26T20:00:00.000Z',
    platform: { os: 'win32', arch: 'x64', release: '10.0.26300' },
    node: { path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v24.13.0' },
    interactiveSession: true,
    longPathsEnabled: false,
    programs: { ffmpeg: fullFfmpeg, ffprobe },
    browsers: [edgeHardware],
    gpu: null,
    lanes: { html: true, three: true, blender: false, audio: true },
    narration: { installed: false, weightsVerified: false },
    problems: [],
  };

  it('round-trips a valid manifest through tools.json', () => {
    const path = writeToolsManifest(dataDir, manifest);
    assert.equal(path, toolsManifestPath(dataDir));
    assert.equal(path, join(dataDir, 'tools.json'));
    assert.deepEqual(readToolsManifest(dataDir), manifest);
    assert.ok(readFileSync(path, 'utf8').endsWith('}\n'));
  });

  it('refuses to write an invalid manifest', () => {
    const bad = { ...manifest, lanes: { html: 'yes' } } as unknown as ToolsManifest;
    assert.throws(() => writeToolsManifest(join(dataDir, 'never'), bad), (error: unknown) => error instanceof SchemaValidationError && error.kind === 'tools');
  });

  it('tells the reader to run doctor when the manifest is missing and names the problems when it is invalid', () => {
    const empty = join(dataDir, 'empty');
    mkdirSync(empty);
    assert.throws(() => readToolsManifest(empty), (error: unknown) => error instanceof DataFileError && error.path === toolsManifestPath(empty) && /Run doctor/.test(error.hint));
    writeFileSync(toolsManifestPath(empty), JSON.stringify({ kind: 'tools', version: 1 }), 'utf8');
    assert.throws(() => readToolsManifest(empty), (error: unknown) => error instanceof SchemaValidationError && error.problems.some((problem) => /generatedAt/.test(problem)));
  });
});

describe('buildToolsManifest with fake programs', () => {
  let root = '';
  before(() => { root = mkdtempSync(join(tmpdir(), 'vf-build-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  /** A Windows tree with ffmpeg, ffprobe, PowerShell, reg.exe, Edge and a Blender under Program Files; returns the environment that finds them. */
  function windowsTree(name: string): { readonly env: Record<string, string>; readonly ffmpegExe: string; readonly ffprobeExe: string; readonly edgeExe: string; readonly blenderExe: string } {
    const bin = join(root, name, 'bin');
    const ffmpegExe = touch(join(bin, 'ffmpeg.exe'));
    const ffprobeExe = touch(join(bin, 'ffprobe.exe'));
    touch(join(bin, 'powershell.exe'));
    touch(join(bin, 'reg.exe'));
    const edgeExe = touch(join(root, name, 'pf86', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    const blenderExe = touch(join(root, name, 'pf', 'Blender Foundation', 'Blender 5.2', 'blender.exe'), 'blender');
    const env = { PATH: bin, 'ProgramFiles(x86)': join(root, name, 'pf86'), ProgramFiles: join(root, name, 'pf'), SystemRoot: join(root, name, 'no-windows') };
    return { env, ffmpegExe, ffprobeExe, edgeExe, blenderExe };
  }

  /** The runs a Windows tree causes before Blender is probed: session, long paths, ffmpeg, ffprobe, the Edge version, the GPU and blender --version. */
  function expectWindowsRuns(runner: FakeProcessRunner, blenderVersionLine: string): void {
    runner.expect(matchProgram('powershell.exe'), okResult('True\r\n'));
    runner.expect(matchProgram('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled']), okResult('    LongPathsEnabled    REG_DWORD    0x1\r\n'));
    runner.expect(matchProgram('ffmpeg.exe', ['-version']), okResult('ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright\n'));
    runner.expect(matchProgram('ffmpeg.exe', ['-hide_banner', '-filters']), okResult([...requiredFilters, ...sheetFilters].map((name) => ` .. ${name}  V->V  x`).join('\n')));
    runner.expect(matchProgram('ffmpeg.exe', ['-hide_banner', '-encoders']), okResult([...requiredEncoders, 'libx265'].map((name) => ` V....D ${name}  x`).join('\n')));
    runner.expect(matchProgram('ffprobe.exe', ['-version']), okResult('ffprobe version 9.0.2-full_build-www.gyan.dev Copyright\n'));
    runner.expect(matchProgram('powershell.exe'), okResult('156.0.4314.42\r\n'));
    runner.expect(matchProgram('powershell.exe'), okResult('NVIDIA GeForce RTX 2060|32.0.16.1088\r\n'));
    runner.expect(matchProgram('blender.exe', ['--version']), okResult(blenderVersionLine));
  }

  it('records nothing found on a bare Linux machine and flags the non-interactive session', async () => {
    const dataDir = join(root, 'bare');
    mkdirSync(dataDir);
    const manifest = await buildToolsManifest(contextFor(dataDir, new FakeProcessRunner()), { skipBrowserCheck: true, skipBlenderProbe: true, env: {}, platform: 'linux' });
    assert.equal(manifest.generatedAt, '2026-10-26T20:00:00.000Z');
    assert.deepEqual(manifest.programs, {});
    assert.deepEqual(manifest.browsers, []);
    assert.equal(manifest.gpu, null);
    assert.equal(manifest.longPathsEnabled, null);
    assert.equal(manifest.interactiveSession, false);
    assert.deepEqual(manifest.lanes, { html: false, three: false, blender: false, audio: false });
    assert.equal(manifest.problems.length, 1);
    assert.match(manifest.problems[0] ?? '', /not an interactive desktop session/);
    writeToolsManifest(dataDir, manifest);
  });

  it('assembles a Windows machine with ffmpeg, Edge, PowerShell, reg.exe and a probed Blender 5.2', async () => {
    const tree = windowsTree('win');
    const runner = new FakeProcessRunner();
    expectWindowsRuns(runner, 'Blender 5.2.3 LTS\r\n');
    runner.expect(matchProgram('blender.exe', blenderProbeArgs), okResult(probeLine));
    const dataDir = join(root, 'win-data');
    mkdirSync(dataDir);
    const manifest = await buildToolsManifest(contextFor(dataDir, runner), { skipBrowserCheck: true, skipBlenderProbe: false, env: tree.env, platform: 'win32' });
    runner.assertAllUsed();
    assert.equal(manifest.platform.os, 'win32');
    assert.equal(manifest.interactiveSession, true);
    assert.equal(manifest.longPathsEnabled, true);
    assert.equal(manifest.programs.ffmpeg?.path, tree.ffmpegExe);
    assert.equal(manifest.programs.ffmpeg?.version, '9.0.2-full_build-www.gyan.dev');
    assert.deepEqual(manifest.programs.ffmpeg?.encoders, [...requiredEncoders, 'libx265']);
    assert.equal(manifest.programs.ffprobe?.path, tree.ffprobeExe);
    assert.deepEqual(manifest.browsers, [{ channel: 'msedge', path: tree.edgeExe, version: '156.0.4314.42', webgl: null }]);
    assert.deepEqual(manifest.gpu, { name: 'NVIDIA GeForce RTX 2060', driver: '32.0.16.1088' });
    assert.equal(manifest.programs.blender?.path, tree.blenderExe);
    assert.equal(manifest.programs.blender?.version, '5.2.3');
    assert.match(manifest.programs.blender?.sha256 ?? '', /^[0-9a-f]{64}$/);
    assert.deepEqual(manifest.programs.blender?.engines, ['BLENDER_EEVEE', 'CYCLES']);
    assert.deepEqual(manifest.programs.blender?.devices, [{ name: 'NVIDIA GeForce RTX 2060', type: 'OPTIX' }, { name: 'CPU', type: 'CPU' }]);
    assert.equal(manifest.programs.blender?.actionSlots, true);
    assert.deepEqual(manifest.lanes, { html: true, three: false, blender: true, audio: true });
    assert.deepEqual(manifest.problems, []);
    writeToolsManifest(dataDir, manifest);
    assert.deepEqual(readToolsManifest(dataDir), manifest);
  });

  it('keeps the blender lane open, with the warning under problems, when Blender crashes at teardown after the probe reported', async () => {
    const tree = windowsTree('crash');
    const runner = new FakeProcessRunner();
    expectWindowsRuns(runner, 'Blender 5.2.3 LTS\r\n');
    runner.expect(matchProgram('blender.exe', blenderProbeArgs), failedResult(3221225477, 'EXCEPTION_ACCESS_VIOLATION', probeLine));
    const dataDir = join(root, 'crash-data');
    mkdirSync(dataDir);
    const manifest = await buildToolsManifest(contextFor(dataDir, runner), { skipBrowserCheck: true, skipBlenderProbe: false, env: tree.env, platform: 'win32' });
    runner.assertAllUsed();
    assert.equal(manifest.lanes.blender, true);
    assert.deepEqual(manifest.programs.blender?.engines, ['BLENDER_EEVEE', 'CYCLES']);
    assert.equal(manifest.problems.length, 1);
    assert.match(manifest.problems[0] ?? '', /Blender then exited with code 3221225477/);
    writeToolsManifest(dataDir, manifest);
  });

  it('records a failed WebGL check and a software rasterizer as problems through the capability reader', async () => {
    const bin = join(root, 'linux-bin');
    const chrome = touch(join(bin, 'google-chrome'));
    const env = { PATH: bin, DISPLAY: ':0' };
    const dataDir = join(root, 'linux-data');
    mkdirSync(dataDir);
    const failing = new FakeProcessRunner();
    failing.expect(matchProgram('google-chrome', ['--version']), okResult('Google Chrome 156.0.8078.47\n'));
    const failed = await buildToolsManifest(contextFor(dataDir, failing), { skipBrowserCheck: false, skipBlenderProbe: true, env, platform: 'linux', readCapabilities: constantReader({ report: null, reason: 'browserType.launchPersistentContext: policy blocks headless mode' }) });
    assert.deepEqual(failed.browsers, [{ channel: 'chrome', path: chrome, version: '156.0.8078.47', webgl: null }]);
    assert.deepEqual(failed.problems, [describeFailedWebglCheck('chrome', 'browserType.launchPersistentContext: policy blocks headless mode')]);
    assert.equal(failed.problems[0], 'chrome: the WebGL check failed: browserType.launchPersistentContext: policy blocks headless mode.');
    const software = new FakeProcessRunner();
    software.expect(matchProgram('google-chrome', ['--version']), okResult('Google Chrome 156.0.8078.47\n'));
    const slow = await buildToolsManifest(contextFor(dataDir, software), { skipBrowserCheck: false, skipBlenderProbe: true, env, platform: 'linux', readCapabilities: constantReader({ report: swiftShader }) });
    assert.deepEqual(slow.browsers[0]?.webgl, swiftShader);
    assert.deepEqual(slow.problems, [describeSoftwareRenderer('chrome', swiftShader.renderer)]);
    assert.match(slow.problems[0] ?? '', /^chrome renders WebGL with a software rasterizer \(ANGLE \(Google, Vulkan .*SwiftShader driver\)\); the three lane will be slow/);
    const skipped = await buildToolsManifest(contextFor(dataDir, (() => { const r = new FakeProcessRunner(); r.expect(matchProgram('google-chrome'), okResult('Google Chrome 156.0.8078.47\n')); return r; })()), { skipBrowserCheck: true, skipBlenderProbe: true, env, platform: 'linux', readCapabilities: constantReader({ report: swiftShader }) });
    assert.deepEqual(skipped.problems, [], 'a skipped check records nothing');
    writeToolsManifest(dataDir, slow);
  });

  it('reports a CHROME override that is not a runnable file instead of silently finding no browser', async () => {
    const dataDir = join(root, 'chrome-data');
    mkdirSync(dataDir);
    const override = join(root, 'nowhere', 'chrome.exe');
    const manifest = await buildToolsManifest(contextFor(dataDir, new FakeProcessRunner()), { skipBrowserCheck: true, skipBlenderProbe: true, env: { CHROME: override, DISPLAY: ':0' }, platform: 'linux' });
    assert.deepEqual(manifest.browsers, []);
    assert.equal(manifest.problems.length, 1);
    assert.match(manifest.problems[0] ?? '', /^CHROME is set to .*chrome\.exe, which is not a runnable file/);
  });

  it('keeps an unsupported Blender in the manifest, closes its lane and records the install command', async () => {
    const blenderExe = touch(join(root, 'old', 'Blender Foundation', 'Blender 5.2', 'blender.exe'), 'old');
    const env = { ProgramFiles: join(root, 'old'), SystemRoot: join(root, 'no-windows') };
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender.exe', ['--version']), okResult('Blender 4.5.15 LTS\r\n'));
    const dataDir = join(root, 'old-data');
    mkdirSync(dataDir);
    const manifest = await buildToolsManifest(contextFor(dataDir, runner), { skipBrowserCheck: true, skipBlenderProbe: false, env, platform: 'win32' });
    runner.assertAllUsed();
    assert.equal(manifest.programs.blender?.path, blenderExe);
    assert.equal(manifest.programs.blender?.version, '4.5.15');
    assert.equal(manifest.programs.blender?.engines, undefined);
    assert.equal(manifest.lanes.blender, false);
    assert.ok(manifest.problems.some((problem) => /Blender 4\.5\.15 .* is not supported.*winget install --id BlenderFoundation\.Blender --version 5\.2\.3 --exact/.test(problem)), manifest.problems.join('\n'));
  });

  it('records a failed probe as a problem and closes the blender lane, without the probe fields', async () => {
    touch(join(root, 'bad', 'Blender Foundation', 'Blender 5.2', 'blender.exe'), 'bad');
    const env = { ProgramFiles: join(root, 'bad'), SystemRoot: join(root, 'no-windows') };
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('blender.exe', ['--version']), okResult('Blender 5.2.3 LTS\r\n'));
    runner.expect(matchProgram('blender.exe', blenderProbeArgs), failedResult(3, "KeyError: 'cycles'"));
    const dataDir = join(root, 'bad-data');
    mkdirSync(dataDir);
    const manifest = await buildToolsManifest(contextFor(dataDir, runner), { skipBrowserCheck: true, skipBlenderProbe: false, env, platform: 'win32' });
    assert.equal(manifest.programs.blender?.version, '5.2.3');
    assert.equal(manifest.programs.blender?.python, undefined);
    assert.equal(manifest.lanes.blender, false);
    assert.ok(manifest.problems.some((problem) => /Blender probe raised a Python exception/.test(problem)));
    writeToolsManifest(dataDir, manifest);
  });
});
