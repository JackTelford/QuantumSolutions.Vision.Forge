import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mulberry32, noiseChannels, noiseSample, smoothNoise } from '../../../src/shared/camera/noise.ts';
import { assertClose } from './fixtures.ts';

const epsilon = 1e-12;
const sampleCount = 1000;

describe('mulberry32', () => {
  it('gives the same sequence for the same seed and fractions in [0, 1)', () => {
    const first = mulberry32(42);
    const second = mulberry32(42);
    for (let i = 0; i < sampleCount; i += 1) {
      const value = first();
      assert.equal(value, second(), `sample ${i}`);
      assert.ok(value >= 0 && value < 1, `range ${value}`);
    }
  });

  it('gives a different sequence for a different seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differences = 0;
    for (let i = 0; i < sampleCount; i += 1) if (a() !== b()) differences += 1;
    assert.ok(differences > sampleCount * 0.9, `${differences} of ${sampleCount} differ`);
  });

  it('spreads its output over the unit interval rather than clustering', () => {
    const next = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < sampleCount; i += 1) sum += next();
    assertClose(sum / sampleCount, 0.5, 0.05, 'mean');
  });
});

describe('noiseSample', () => {
  it('is a pure function of seed, channel and index in [-1, 1]', () => {
    for (let index = -5; index < 50; index += 1) {
      const value = noiseSample(7, noiseChannels.yaw, index);
      assert.equal(value, noiseSample(7, noiseChannels.yaw, index), `index ${index}`);
      assert.ok(value >= -1 && value <= 1, `range ${value}`);
    }
  });

  it('separates seeds and channels', () => {
    assert.notEqual(noiseSample(7, noiseChannels.pitch, 3), noiseSample(8, noiseChannels.pitch, 3));
    assert.notEqual(noiseSample(7, noiseChannels.pitch, 3), noiseSample(7, noiseChannels.roll, 3));
    assert.notEqual(noiseSample(7, noiseChannels.pitch, 3), noiseSample(7, noiseChannels.pitch, 4));
  });
});

describe('smoothNoise', () => {
  it('passes through the samples at integer positions and their mean half way between', () => {
    const a = noiseSample(7, noiseChannels.positionUp, 4);
    const b = noiseSample(7, noiseChannels.positionUp, 5);
    assertClose(smoothNoise(7, noiseChannels.positionUp, 4), a, epsilon, 'at 4');
    assertClose(smoothNoise(7, noiseChannels.positionUp, 5), b, epsilon, 'at 5');
    assertClose(smoothNoise(7, noiseChannels.positionUp, 4.5), (a + b) / 2, epsilon, 'half way');
  });

  it('changes by no more than the cosine slope bound between fine steps, so the shake has no steps', () => {
    const step = 1 / 200;
    const maxSlope = Math.PI;
    let previous = smoothNoise(7, noiseChannels.roll, 0);
    for (let position = step; position <= 10; position += step) {
      const value = smoothNoise(7, noiseChannels.roll, position);
      assert.ok(Math.abs(value - previous) <= maxSlope * step + epsilon, `jump at ${position}: ${Math.abs(value - previous)}`);
      previous = value;
    }
  });

  it('has zero slope at every sample so the shake never turns sharply', () => {
    const tiny = 1e-4;
    const at = smoothNoise(7, noiseChannels.yaw, 3);
    const after = smoothNoise(7, noiseChannels.yaw, 3 + tiny);
    assert.ok(Math.abs(after - at) < tiny * tiny * 100, `slope ${Math.abs(after - at) / tiny}`);
  });
});
