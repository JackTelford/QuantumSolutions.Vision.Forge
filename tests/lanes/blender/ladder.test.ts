import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryLogger } from '../../../src/cli/logger.ts';
import { BlenderRenderError, BlenderScriptError } from '../../../src/errors/blender-errors.ts';
import { VisionForgeError } from '../../../src/errors/vision-forge-error.ts';
import { ladderAttempt, parseBlenderProfile, renderAttempt, rungName, rungProfile, runLadder, stillAttempts, stillLadder } from '../../../src/lanes/blender/ladder.ts';
import type { LadderAttempt, StillLadderOptions } from '../../../src/lanes/blender/ladder.ts';
import { RenderProfileMismatchError } from '../../../src/render/command-support.ts';

const gpuMachine: StillLadderOptions = { width: 1920, deviceTypes: ['OPTIX', 'CUDA', 'CPU'], interactiveSession: true, policy: 'any' };

function names(attempts: readonly LadderAttempt[]): readonly string[] {
  return attempts.map((attempt) => attempt.name);
}

describe('the ladder', () => {
  it('tries EEVEE on OpenGL, EEVEE on Vulkan, Cycles on OptiX, CUDA and the CPU, in that order', () => {
    assert.deepEqual(stillLadder.map(rungName), ['eevee-opengl', 'eevee-vulkan', 'cycles-OPTIX', 'cycles-CUDA', 'cycles-CPU']);
    assert.deepEqual(names(stillAttempts(gpuMachine)), ['eevee-opengl', 'eevee-vulkan', 'cycles-OPTIX', 'cycles-CUDA', 'cycles-CPU']);
  });

  it('pins the CPU rung as the software renderer and every other rung as hardware', () => {
    assert.deepEqual(rungProfile({ engine: 'cycles', backend: 'CPU' }), { engine: 'cycles', backend: 'CPU', renderer: 'software' });
    assert.deepEqual(rungProfile({ engine: 'eevee', backend: 'opengl' }), { engine: 'eevee', backend: 'opengl', renderer: 'hardware' });
    assert.deepEqual(rungProfile({ engine: 'cycles', backend: 'OPTIX' }), { engine: 'cycles', backend: 'OPTIX', renderer: 'hardware' });
  });

  it('leaves out OptiX without an OptiX device and CUDA without a CUDA device, keeping the CPU', () => {
    assert.deepEqual(names(stillAttempts({ ...gpuMachine, deviceTypes: ['CUDA', 'CPU'] })), ['eevee-opengl', 'eevee-vulkan', 'cycles-CUDA', 'cycles-CPU']);
    assert.deepEqual(names(stillAttempts({ ...gpuMachine, deviceTypes: ['CPU'] })), ['eevee-opengl', 'eevee-vulkan', 'cycles-CPU']);
    assert.deepEqual(names(stillAttempts({ ...gpuMachine, deviceTypes: [] })), ['eevee-opengl', 'eevee-vulkan', 'cycles-CPU'], 'a skipped probe leaves the CPU among the Cycles rungs');
  });

  it('leaves out the EEVEE rungs without an interactive session', () => {
    assert.deepEqual(names(stillAttempts({ ...gpuMachine, interactiveSession: false })), ['cycles-OPTIX', 'cycles-CUDA', 'cycles-CPU']);
  });

  it('sends a 4K still straight to Cycles with denoising samples', () => {
    const attempts = stillAttempts({ ...gpuMachine, width: 3840 });
    assert.deepEqual(names(attempts), ['cycles-OPTIX', 'cycles-CUDA', 'cycles-CPU']);
    assert.equal(attempts[0]?.attempt.samples, 256);
    assert.equal(stillAttempts({ ...gpuMachine, width: 3839 })[0]?.name, 'eevee-opengl');
  });

  it('narrows to the GPU rungs under --renderer hardware and to the CPU under --renderer software', () => {
    assert.deepEqual(names(stillAttempts({ ...gpuMachine, policy: 'hardware' })), ['eevee-opengl', 'eevee-vulkan', 'cycles-OPTIX', 'cycles-CUDA']);
    assert.deepEqual(names(stillAttempts({ ...gpuMachine, policy: 'software' })), ['cycles-CPU']);
    assert.deepEqual(names(stillAttempts({ ...gpuMachine, policy: 'hardware', interactiveSession: false, deviceTypes: ['CPU'] })), []);
  });

  it('gives a still more samples than a clip and a Cycles attempt its device', () => {
    const still = ladderAttempt({ engine: 'eevee', backend: 'vulkan' }, 'still', 1920);
    assert.deepEqual(still.attempt, { engine: 'eevee', device: null, samples: 128 });
    assert.equal(still.gpuBackend, 'vulkan');
    const clip = ladderAttempt({ engine: 'eevee', backend: 'vulkan' }, 'render', 1920);
    assert.equal(clip.attempt.samples, 64);
    const cycles = ladderAttempt({ engine: 'cycles', backend: 'OPTIX' }, 'render', 1920);
    assert.deepEqual(cycles.attempt, { engine: 'cycles', device: 'OPTIX', samples: 128 });
    assert.equal(cycles.gpuBackend, null);
  });

  it('reads a pinned Blender profile back into its rung and refuses a browser profile or a wrong renderer', () => {
    assert.deepEqual(parseBlenderProfile({ engine: 'cycles', backend: 'CUDA', renderer: 'hardware' }), { engine: 'cycles', backend: 'CUDA' });
    assert.equal(parseBlenderProfile({ engine: 'chromium', backend: 'd3d11', renderer: 'hardware' }), undefined);
    assert.equal(parseBlenderProfile({ engine: 'cycles', backend: 'CPU', renderer: 'hardware' }), undefined, 'the CPU rung is the software renderer');
    assert.equal(parseBlenderProfile({ engine: 'eevee', backend: 'metal', renderer: 'hardware' }), undefined);
  });
});

describe('renderAttempt', () => {
  it('runs the pinned GPU rung with clip samples, for the render purpose, under --renderer any or the pinned renderer', () => {
    const attempt = renderAttempt('s02', { engine: 'eevee', backend: 'opengl', renderer: 'hardware' }, 1920, 'any');
    assert.equal(attempt.name, 'eevee-opengl');
    assert.equal(attempt.attempt.samples, 64);
    assert.equal(attempt.purpose, 'render');
    assert.equal(renderAttempt('s02', { engine: 'eevee', backend: 'opengl', renderer: 'hardware' }, 1920, 'hardware').name, 'eevee-opengl');
    assert.equal(ladderAttempt({ engine: 'cycles', backend: 'OPTIX' }, 'still', 1920).purpose, 'still');
  });

  it('refuses to render a shot without a pinned profile, with the render-profile-mismatch code', () => {
    assert.throws(() => renderAttempt('s02', null, 1920, 'any'), (error: unknown) => error instanceof RenderProfileMismatchError && error.code === 'render-profile-mismatch' && /no render profile pinned/.test(error.message));
  });

  it('refuses a profile that is not a Blender rung', () => {
    assert.throws(() => renderAttempt('s02', { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' }, 1920, 'any'), (error: unknown) => error instanceof RenderProfileMismatchError && /not a Blender engine/.test(error.message));
  });

  it('refuses the CPU rung, which is legal for stills only, with a sentence that says what to do', () => {
    assert.throws(() => renderAttempt('s02', { engine: 'cycles', backend: 'CPU', renderer: 'software' }, 1920, 'any'), (error: unknown) => error instanceof RenderProfileMismatchError && /legal for stills only/.test(error.message) && /another lane/.test(error.message));
    assert.throws(() => renderAttempt('s02', { engine: 'cycles', backend: 'CPU', renderer: 'software' }, 1920, 'software'), /legal for stills only/, 'asking for the software renderer does not make the CPU pin renderable');
  });

  it('refuses a fixed --renderer that disagrees with the pin, as the browser lanes do, before anything launches', () => {
    assert.throws(() => renderAttempt('s02', { engine: 'eevee', backend: 'vulkan', renderer: 'hardware' }, 1920, 'software'), (error: unknown) => error instanceof RenderProfileMismatchError && error.code === 'render-profile-mismatch' && /"s02" was pinned to the hardware renderer \(eevee on vulkan\) by the still gate, but --renderer software was asked for/.test(error.message));
  });
});

describe('runLadder', () => {
  const attempts = stillAttempts(gpuMachine);

  it('returns the first attempt that renders and the value it produced', async () => {
    const log = new MemoryLogger();
    const outcome = await runLadder(attempts, (attempt) => Promise.resolve(`rendered by ${attempt.name}`), log);
    assert.equal(outcome.attempt.name, 'eevee-opengl');
    assert.equal(outcome.value, 'rendered by eevee-opengl');
  });

  it('moves down one rung per Blender failure, logging each reason, and pins the rung that rendered', async () => {
    const log = new MemoryLogger();
    const tried: string[] = [];
    const outcome = await runLadder(attempts, (attempt) => {
      tried.push(attempt.name);
      if (tried.length < 3) return Promise.reject(new BlenderRenderError(`no GPU context for ${attempt.name}.`, { scenePath: 'scene.json', stderrTail: 'gpu.init failed' }));
      return Promise.resolve(attempt.profile);
    }, log);
    assert.deepEqual(tried, ['eevee-opengl', 'eevee-vulkan', 'cycles-OPTIX']);
    assert.deepEqual(outcome.value, { engine: 'cycles', backend: 'OPTIX', renderer: 'hardware' });
    assert.equal(log.messages.filter((message) => /^warn: blender attempt .* failed \(blender-render\)/.test(message)).length, 2);
  });

  it('throws the last rung\'s error when every rung fails', async () => {
    await assert.rejects(
      runLadder(attempts, (attempt) => Promise.reject(new BlenderScriptError({ scenePath: `${attempt.name}.json`, stderrTail: 'KeyError' })), new MemoryLogger()),
      (error: unknown) => error instanceof BlenderScriptError && /cycles-CPU\.json/.test(error.message),
    );
  });

  it('stops at once on an error that is not a Blender failure', async () => {
    const tried: string[] = [];
    await assert.rejects(runLadder(attempts, (attempt) => { tried.push(attempt.name); return Promise.reject(new Error('ffmpeg is broken')); }, new MemoryLogger()), /ffmpeg is broken/);
    assert.deepEqual(tried, ['eevee-opengl']);
  });

  it('refuses an empty ladder with a sentence naming what opens the rungs', async () => {
    await assert.rejects(runLadder([], () => Promise.resolve(1), new MemoryLogger()), (error: unknown) => error instanceof VisionForgeError && error.code === 'blender-render' && /interactive desktop session/.test(error.hint));
  });
});
