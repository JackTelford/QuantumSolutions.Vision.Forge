import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { angleBackend, browserArgs, browserEngine, browserRenderProfile, rendererPolicies } from '../../src/harness/types.ts';
import { browserLaunchFlags } from '../../src/plan/shot-key.ts';

describe('angleBackend', () => {
  it('picks the native backend per platform for hardware and SwiftShader everywhere for software', () => {
    assert.equal(angleBackend('hardware', 'win32'), 'd3d11');
    assert.equal(angleBackend('hardware', 'darwin'), 'metal');
    assert.equal(angleBackend('hardware', 'linux'), 'gl');
    for (const platform of ['win32', 'darwin', 'linux'] as const) assert.equal(angleBackend('software', platform), 'swiftshader-webgl', platform);
  });
});

describe('browserArgs', () => {
  it('is exactly the shot key flag set followed by one --use-angle flag', () => {
    assert.deepEqual(browserArgs('hardware', 'win32'), [...browserLaunchFlags, '--use-angle=d3d11']);
    assert.deepEqual(browserArgs('software', 'linux'), [...browserLaunchFlags, '--use-angle=swiftshader-webgl']);
    const args = browserArgs('hardware');
    assert.equal(args.length, browserLaunchFlags.length + 1);
    assert.equal(args.filter((flag) => flag.startsWith('--use-angle=')).length, 1);
    assert.deepEqual(args.slice(0, browserLaunchFlags.length), [...browserLaunchFlags]);
  });
});

describe('browserRenderProfile and the policies', () => {
  it('records chromium with the backend and renderer', () => {
    assert.deepEqual(browserRenderProfile('hardware', 'win32'), { engine: browserEngine, backend: 'd3d11', renderer: 'hardware' });
    assert.deepEqual(browserRenderProfile('software', 'darwin'), { engine: 'chromium', backend: 'swiftshader-webgl', renderer: 'software' });
    assert.deepEqual(rendererPolicies, ['hardware', 'software', 'any']);
  });
});
