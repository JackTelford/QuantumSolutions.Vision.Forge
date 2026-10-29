import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ToolMissingError } from '../../src/errors/vision-forge-error.ts';
import { buildFingerprint, clearTypeValueNames, desktopKey, readMachineFingerprint, registryDecimalText, threeVersion, toolVersionsHash, windowMetricsKey } from '../../src/harness/fingerprint.ts';
import { repositoryRoot } from '../../src/harness/served-roots.ts';
import type { BrowserFingerprint } from '../../src/harness/types.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import type { RenderManifest } from '../../src/shared/contracts/render-manifest.ts';
import { contentHash } from '../../src/shared/sha256.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

/** One value line as `reg query <key> /v <name>` prints it. */
function regOutput(key: string, name: string, type: string, data: string): string {
  return `\r\n${key.replace('HKCU', 'HKEY_CURRENT_USER')}\r\n    ${name}    ${type}    ${data}\r\n\r\n`;
}

/** Scripts the five queries the owner's machine answers (probe P5 recorded these values). */
function expectOwnerMachine(runner: FakeProcessRunner): void {
  runner.expect(matchProgram('reg.exe', ['query', windowMetricsKey, '/v', 'AppliedDPI']), okResult(regOutput(windowMetricsKey, 'AppliedDPI', 'REG_DWORD', '0x78')));
  runner.expect(matchProgram('reg.exe', ['query', desktopKey, '/v', 'FontSmoothing']), okResult(regOutput(desktopKey, 'FontSmoothing', 'REG_SZ', '2')));
  runner.expect(matchProgram('reg.exe', ['query', desktopKey, '/v', 'FontSmoothingType']), okResult(regOutput(desktopKey, 'FontSmoothingType', 'REG_DWORD', '0x2')));
  runner.expect(matchProgram('reg.exe', ['query', desktopKey, '/v', 'FontSmoothingOrientation']), okResult(regOutput(desktopKey, 'FontSmoothingOrientation', 'REG_DWORD', '0x1')));
  runner.expect(matchProgram('reg.exe', ['query', desktopKey, '/v', 'FontSmoothingGamma']), okResult(regOutput(desktopKey, 'FontSmoothingGamma', 'REG_DWORD', '0x578')));
}

const browser: BrowserFingerprint = { channel: 'msedge', version: '156.0.4314.42', args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--use-angle=d3d11'], webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)' };

/** A manifest around a fingerprint, so the schema can judge the fingerprint. */
function manifestWith(fingerprint: RenderManifest['fingerprint']): RenderManifest {
  return { kind: 'render-manifest', version: 1, shotId: 's01', key: '0'.repeat(64), lane: 'html', renderProfile: { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' }, fingerprint, fps: 30, width: 1920, height: 1080, frameCount: 1, frames: [], status: 'rendering', startedAt: '2026-10-29T10:00:00.000Z', toolVersionsHash: '0'.repeat(64) };
}

describe('readMachineFingerprint', () => {
  let root = '';
  let bin = '';
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'vf-fingerprint-'));
    bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'reg.exe'), '', 'utf8');
  });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  it('reads AppliedDPI and the four ClearType values through reg.exe on Windows, turning hex into decimal text', async () => {
    const runner = new FakeProcessRunner();
    expectOwnerMachine(runner);
    assert.deepEqual(await readMachineFingerprint(runner, { PATH: bin }, 'win32', never), {
      appliedDpi: 120,
      clearType: { fontSmoothing: '2', fontSmoothingType: '2', orientation: '1', gamma: '1400' },
    });
    runner.assertAllUsed();
    assert.deepEqual(runner.invocations.map((spec) => spec.args[3]), ['AppliedDPI', ...Object.values(clearTypeValueNames)]);
  });

  it('omits both keys off Windows without running anything', async () => {
    const runner = new FakeProcessRunner();
    const fingerprint = await readMachineFingerprint(runner, { PATH: bin }, 'linux', never);
    assert.deepEqual(fingerprint, {});
    assert.equal('appliedDpi' in fingerprint, false);
    assert.equal('clearType' in fingerprint, false);
    assert.deepEqual(runner.invocations, []);
  });

  it('omits a value reg.exe cannot read, and the whole ClearType group when one of its four is missing', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('reg.exe', ['query', windowMetricsKey, '/v', 'AppliedDPI']), failedResult(1, 'ERROR: The system was unable to find the specified registry key or value.'));
    runner.expect(matchProgram('reg.exe', ['query', desktopKey, '/v', 'FontSmoothing']), okResult(regOutput(desktopKey, 'FontSmoothing', 'REG_SZ', '2')));
    runner.expect(matchProgram('reg.exe', ['query', desktopKey, '/v', 'FontSmoothingType']), okResult(regOutput(desktopKey, 'FontSmoothingType', 'REG_DWORD', '0x2')));
    runner.expect(matchProgram('reg.exe', ['query', desktopKey, '/v', 'FontSmoothingOrientation']), failedResult(1, 'ERROR'));
    runner.expect(matchProgram('reg.exe', ['query', desktopKey, '/v', 'FontSmoothingGamma']), okResult(regOutput(desktopKey, 'FontSmoothingGamma', 'REG_DWORD', '0x578')));
    const fingerprint = await readMachineFingerprint(runner, { PATH: bin }, 'win32', never);
    assert.deepEqual(fingerprint, {});
    runner.assertAllUsed();
  });

  it('turns hex into decimal text and leaves other data as it is', () => {
    assert.equal(registryDecimalText('0x78'), '120');
    assert.equal(registryDecimalText('0x0'), '0');
    assert.equal(registryDecimalText('2'), '2');
    assert.equal(registryDecimalText(' 2 '), '2');
  });
});

describe('threeVersion', () => {
  it('reads the pinned three version from the installed package', () => {
    assert.equal(threeVersion(repositoryRoot), '0.186.1');
    assert.equal(threeVersion(), '0.186.1');
  });

  it('names the missing package when three is not installed', () => {
    const root = mkdtempSync(join(tmpdir(), 'vf-no-three-'));
    try {
      assert.throws(() => threeVersion(root), (error: unknown) => error instanceof ToolMissingError && error.hint.includes('npm ci'));
      mkdirSync(join(root, 'node_modules', 'three'), { recursive: true });
      writeFileSync(join(root, 'node_modules', 'three', 'package.json'), '{"name":"three"}', 'utf8');
      assert.throws(() => threeVersion(root), (error: unknown) => error instanceof ToolMissingError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('buildFingerprint and toolVersionsHash', () => {
  it('records the browser, the renderer string, the machine values and the tool versions in the manifest shape', () => {
    const fingerprint = buildFingerprint({
      browser,
      machine: { appliedDpi: 96, clearType: { fontSmoothing: '2', fontSmoothingType: '2', orientation: '1', gamma: '1400' } },
      node: 'v24.13.0',
      three: '0.186.1',
      ffmpeg: '9.0.2',
    });
    assert.deepEqual(fingerprint, {
      browser: { channel: 'msedge', version: '156.0.4314.42', args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--use-angle=d3d11'] },
      webglRenderer: browser.webglRenderer,
      appliedDpi: 96,
      clearType: { fontSmoothing: '2', fontSmoothingType: '2', orientation: '1', gamma: '1400' },
      node: 'v24.13.0',
      three: '0.186.1',
      ffmpeg: '9.0.2',
    });
    assert.doesNotThrow(() => validateDocument('render-manifest', manifestWith(fingerprint)));
  });

  it('leaves the machine and three keys absent, not undefined, when they are not given', () => {
    const fingerprint = buildFingerprint({ browser, machine: {}, node: 'v24.13.0', ffmpeg: '9.0.2' });
    assert.deepEqual(Object.keys(fingerprint), ['browser', 'webglRenderer', 'node', 'ffmpeg']);
    assert.doesNotThrow(() => validateDocument('render-manifest', manifestWith(fingerprint)));
  });

  it('hashes the fingerprint as canonical JSON, so equal fingerprints hash alike and a changed flag does not', async () => {
    const fingerprint = buildFingerprint({ browser, machine: { appliedDpi: 96 }, node: 'v24.13.0', ffmpeg: '9.0.2' });
    const hash = await toolVersionsHash(fingerprint);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, await contentHash(fingerprint));
    assert.equal(hash, await toolVersionsHash(buildFingerprint({ browser: { ...browser }, machine: { appliedDpi: 96 }, node: 'v24.13.0', ffmpeg: '9.0.2' })));
    assert.notEqual(hash, await toolVersionsHash(buildFingerprint({ browser: { ...browser, args: [...browser.args.slice(0, 2), '--use-angle=swiftshader-webgl'] }, machine: { appliedDpi: 96 }, node: 'v24.13.0', ffmpeg: '9.0.2' })));
  });
});
