import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { failureResult, successResult } from '../../src/cli/result.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { SchemaValidationError } from '../../src/errors/vision-forge-error.ts';
import { documentKinds } from '../../src/schema/schema-registry.ts';
import { assertKind, isDateTime, validateDocument } from '../../src/schema/validator.ts';
import type { CliResult as CliResultContract } from '../../src/shared/contracts/cli-result.ts';
import type { RenderManifest } from '../../src/shared/contracts/render-manifest.ts';
import type { ToolsManifest } from '../../src/shared/contracts/tools.ts';

const hex = (digit: string): string => digit.repeat(64);

const toolsExample: ToolsManifest = {
  kind: 'tools',
  version: 1,
  generatedAt: '2026-10-26T20:00:00.000Z',
  platform: { os: 'win32', arch: 'x64', release: '10.0.26300' },
  node: { path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v24.13.0' },
  interactiveSession: true,
  longPathsEnabled: false,
  programs: {
    ffmpeg: { path: 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe', version: '7.1.1', sha256: hex('a'), filters: ['scale', 'drawtext', 'lut3d'], encoders: ['libx264', 'aac'] },
    ffprobe: { path: 'C:\\Tools\\ffmpeg\\bin\\ffprobe.exe', version: '7.1.1' },
    blender: { path: 'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe', version: '4.2.3', sha256: hex('b') },
  },
  browsers: [
    { channel: 'msedge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', version: '156.0.3700.42', webgl: null },
    { channel: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', version: '156.0.7700.10', webgl: null },
  ],
  gpu: { name: 'NVIDIA GeForce RTX 4080', driver: '581.57' },
  lanes: { html: true, three: true, blender: true, audio: true },
  narration: { installed: false, weightsVerified: false },
  problems: [],
};

const renderExample: RenderManifest = {
  kind: 'render-manifest',
  version: 1,
  shotId: 's01',
  key: hex('0'),
  lane: 'three',
  renderProfile: { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' },
  fingerprint: {
    browser: { channel: 'msedge', version: '156.0.3700.42', args: ['--force-device-scale-factor=1', '--use-angle=d3d11'] },
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    appliedDpi: 96,
    clearType: { fontSmoothing: '2', fontSmoothingType: '2', orientation: '1', gamma: '1400' },
    node: 'v24.13.0',
    three: '0.186.1',
    ffmpeg: '7.1.1',
  },
  fps: 30,
  width: 1920,
  height: 1080,
  frameCount: 2,
  frames: [{ index: 0, sha256: hex('c') }, { index: 1, sha256: hex('d') }],
  status: 'complete',
  startedAt: '2026-10-26T20:00:00.000Z',
  finishedAt: '2026-10-26T20:00:05.250Z',
  toolVersionsHash: hex('e'),
};

/** A deep copy with one value replaced, for mutation tests. */
function mutated<T>(document: T, change: (copy: T) => void): T {
  const copy = structuredClone(document);
  change(copy);
  return copy;
}

function problemsOf(kind: string, document: unknown): readonly string[] {
  try {
    validateDocument(kind, document);
  } catch (error: unknown) {
    assert.ok(error instanceof SchemaValidationError, `expected SchemaValidationError, got ${String(error)}`);
    assert.equal(error.kind, kind);
    return error.problems;
  }
  assert.fail('the document validated but should not have');
}

describe('validateDocument', () => {
  it('accepts a successResult as a cli-result', () => {
    validateDocument('cli-result', successResult('doctor', { data: { lanes: ['html'] }, artifacts: ['C:\\out\\a.png'], evidence: [] }));
  });

  it('accepts a failureResult with a null payload and one error', () => {
    validateDocument('cli-result', failureResult('render', 2, { code: 'usage', message: 'Missing --shot.', hint: 'Pass --shot <id>.' }));
  });

  it('accepts a cli-result whose data is a scalar', () => {
    validateDocument('cli-result', successResult('version', { data: 'v24.13.0' }));
  });

  it('rejects an exit code outside the vocabulary and names /exitCode with the allowed values', () => {
    const bad = mutated(successResult('doctor', { data: null }), (copy) => { (copy as { exitCode: number }).exitCode = 3; });
    const problems = problemsOf('cli-result', bad);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^\/exitCode: .*allowed: 0, 1, 2, 130/);
  });

  it('rejects a cli-result with an extra property and names it', () => {
    const bad = { ...successResult('doctor', { data: null }), extra: true };
    const problems = problemsOf('cli-result', bad);
    assert.deepEqual(problems, ['$: must NOT have additional properties (found "extra")']);
  });

  it('reports every problem of a cli-result at once, root problems under $', () => {
    const problems = problemsOf('cli-result', { kind: 'cli-result', version: 2 });
    assert.ok(problems.includes('/version: must be equal to constant 1'), problems.join('\n'));
    assert.ok(problems.includes("$: must have required property 'command'"), problems.join('\n'));
    assert.ok(problems.length > 5);
  });

  it('accepts a full tools manifest', () => {
    validateDocument('tools', toolsExample);
  });

  it('accepts a tools manifest with nothing found', () => {
    validateDocument('tools', mutated(toolsExample, (copy) => {
      copy.programs = {};
      copy.browsers = [];
      copy.gpu = null;
      copy.longPathsEnabled = null;
      copy.lanes = { html: false, three: false, blender: false, audio: false };
    }));
  });

  it('rejects a tools manifest with an unknown browser channel and names /browsers/0/channel', () => {
    const bad = mutated(toolsExample, (copy) => { (copy.browsers[0] as { channel: string }).channel = 'firefox'; });
    assert.deepEqual(problemsOf('tools', bad), ['/browsers/0/channel: must be equal to one of the allowed values (allowed: msedge, chrome)']);
  });

  it('rejects a tools manifest whose ffmpeg hash is not 64 hex characters', () => {
    const bad = mutated(toolsExample, (copy) => { if (copy.programs.ffmpeg !== undefined) copy.programs.ffmpeg.sha256 = 'abc'; });
    const problems = problemsOf('tools', bad);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^\/programs\/ffmpeg\/sha256: must match pattern/);
  });

  it('rejects a tools manifest with a null gpu name', () => {
    const bad = mutated(toolsExample, (copy) => { (copy as { gpu: { name: unknown } }).gpu.name = null; });
    assert.deepEqual(problemsOf('tools', bad), ['/gpu/name: must be string']);
  });

  it('accepts a full render manifest', () => {
    validateDocument('render-manifest', renderExample);
  });

  it('accepts a render manifest that is still rendering, without the optional fields', () => {
    validateDocument('render-manifest', mutated(renderExample, (copy) => {
      copy.status = 'rendering';
      copy.frames = [];
      copy.fingerprint = { node: 'v24.13.0', ffmpeg: '7.1.1', blender: '4.2.3' };
      copy.lane = 'blender';
      copy.renderProfile = { engine: 'cycles', backend: 'CUDA', renderer: 'hardware' };
      delete copy.finishedAt;
    }));
  });

  it('rejects a render manifest with a short frame hash and names /frames/1/sha256', () => {
    const bad = mutated(renderExample, (copy) => { (copy.frames[1] as { sha256: string }).sha256 = 'deadbeef'; });
    const problems = problemsOf('render-manifest', bad);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^\/frames\/1\/sha256: must match pattern/);
  });

  it('rejects a render manifest with a fractional frame rate and an unknown status', () => {
    const bad = mutated(renderExample, (copy) => {
      copy.fps = 29.97;
      (copy as { status: string }).status = 'done';
    });
    assert.deepEqual(problemsOf('render-manifest', bad), [
      '/fps: must be integer',
      '/status: must be equal to one of the allowed values (allowed: rendering, complete, failed)',
    ]);
  });

  it('rejects a timestamp that is not a date-time and names the format', () => {
    const bad = mutated(toolsExample, (copy) => { copy.generatedAt = 'yesterday'; });
    assert.deepEqual(problemsOf('tools', bad), ['/generatedAt: must match format "date-time"']);
  });

  it('rejects a document validated against the wrong schema and quotes the kind constant', () => {
    const problems = problemsOf('tools', renderExample);
    assert.ok(problems.includes('/kind: must be equal to constant "tools"'), problems.join('\n'));
    assert.ok(problems.includes("$: must have required property 'generatedAt'"), problems.join('\n'));
  });

  it('throws SchemaValidationError for a kind without a schema, with a hint that names the kinds', () => {
    assert.throws(() => validateDocument('scene', {}), (error: unknown) => error instanceof SchemaValidationError && error.kind === 'unknown' && /"scene" is not a known document kind/.test(error.message) && error.hint === `Set "kind" to one of: ${documentKinds.join(', ')}.`);
  });

  it('a generated CliResult contract is assignable to the handwritten CliResult', () => {
    const contract: CliResultContract = { kind: 'cli-result', version: 1, command: 'help', ok: true, exitCode: 0, data: null, artifacts: [], errors: [], evidence: [] };
    const handwritten: CliResult = contract;
    validateDocument('cli-result', handwritten);
  });
});

describe('assertKind', () => {
  it('returns the kind of a known document', () => {
    assert.equal(assertKind({ kind: 'tools' }), 'tools');
    assert.equal(assertKind(renderExample), 'render-manifest');
  });

  it('rejects a document that is not an object, with a hint that names the kinds', () => {
    assert.throws(() => assertKind('tools'), (error: unknown) => error instanceof SchemaValidationError && error.kind === 'unknown' && /must be a JSON object/.test(error.problems[0] ?? '') && error.hint === `Set "kind" to one of: ${documentKinds.join(', ')}.`);
  });

  it('rejects a document without a kind, listing the known kinds', () => {
    assert.throws(() => assertKind({ version: 1 }), (error: unknown) => error instanceof SchemaValidationError && error.kind === 'unknown' && (error.problems[0] ?? '').includes(`known kinds: ${documentKinds.join(', ')}`));
  });

  it('rejects a document whose kind has no schema', () => {
    assert.throws(() => assertKind({ kind: 'scene' }), (error: unknown) => error instanceof SchemaValidationError && error.kind === 'unknown' && /"scene" is not a known document kind/.test(error.problems[0] ?? ''));
  });
});

describe('isDateTime', () => {
  it('accepts RFC 3339 timestamps in UTC and with an offset', () => {
    assert.equal(isDateTime('2026-10-26T20:00:00.000Z'), true);
    assert.equal(isDateTime('2026-10-26T20:00:00Z'), true);
    assert.equal(isDateTime('2026-10-26T22:00:00+02:00'), true);
    assert.equal(isDateTime('2024-02-29T23:59:60-05:30'), true);
    assert.equal(isDateTime('0000-02-29T00:00:00Z'), true, 'year 0 is a leap year and is not 1900');
    assert.equal(isDateTime('0099-12-31T00:00:00Z'), true);
  });

  it('rejects prose, dates without a time, and impossible calendar values', () => {
    assert.equal(isDateTime('yesterday'), false);
    assert.equal(isDateTime('2026-10-26'), false);
    assert.equal(isDateTime('2026-10-26 20:00:00'), false);
    assert.equal(isDateTime('2026-02-30T00:00:00Z'), false);
    assert.equal(isDateTime('0001-02-29T00:00:00Z'), false, 'year 1 is not a leap year');
    assert.equal(isDateTime('2026-13-01T00:00:00Z'), false);
    assert.equal(isDateTime('2026-10-26T24:00:00Z'), false);
    assert.equal(isDateTime('2026-10-26T20:00:00+25:00'), false);
  });
});
