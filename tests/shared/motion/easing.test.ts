import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EasingTokenValues } from '../../../src/shared/contracts/shot-spec.ts';
import type { EasingToken } from '../../../src/shared/contracts/shot-spec.ts';
import {
  ease,
  easingFunction,
  springDampingRatio,
  springEasing,
  springMass,
  springOvershootCap,
  springResponse,
  springSettleSeconds,
  springStiffness,
} from '../../../src/shared/motion/easing.ts';

/** How far a Bézier value may sit from the CSS reference value, which is quoted to four decimals. */
const cssReferenceEpsilon = 0.001;
/** Floating-point slack for values that are exact in theory. */
const exactEpsilon = 1e-9;
/** Steps when sampling a curve for monotonicity. */
const sampleCount = 1000;

const monotonicTokens: readonly EasingToken[] = EasingTokenValues.filter((token) => token !== 'spring');

function samples(token: EasingToken): number[] {
  const curve = easingFunction(token);
  const values: number[] = [];
  for (let step = 0; step <= sampleCount; step += 1) values.push(curve(step / sampleCount));
  return values;
}

describe('easing tokens', () => {
  it('reproduces the CSS reference value of ease at the midpoint', () => {
    assert.ok(Math.abs(ease('ease', 0.5) - 0.8024) <= cssReferenceEpsilon, `ease(0.5) = ${ease('ease', 0.5)}`);
  });

  it('puts the symmetric ease-in-out exactly at the midpoint', () => {
    assert.ok(Math.abs(ease('ease-in-out', 0.5) - 0.5) <= exactEpsilon);
  });

  it('maps 0 to 0 and 1 to 1 for every token', () => {
    for (const token of EasingTokenValues) {
      assert.equal(ease(token, 0), 0, `${token} at 0`);
      assert.equal(ease(token, 1), 1, `${token} at 1`);
    }
  });

  it('clamps normalized time outside 0 to 1 for every token', () => {
    for (const token of EasingTokenValues) {
      assert.equal(ease(token, -0.5), 0, `${token} below 0`);
      assert.equal(ease(token, 1.5), 1, `${token} above 1`);
    }
  });

  it('never decreases for any token but the spring', () => {
    for (const token of monotonicTokens) {
      const values = samples(token);
      for (let index = 1; index < values.length; index += 1) {
        const previous = values[index - 1] ?? 0;
        const current = values[index] ?? 0;
        assert.ok(current >= previous - exactEpsilon, `${token} decreases at step ${index}: ${previous} -> ${current}`);
      }
    }
  });

  it('keeps every token inside 0 to 1 except the spring, which stays under its overshoot cap', () => {
    for (const token of monotonicTokens) {
      for (const value of samples(token)) assert.ok(value >= -exactEpsilon && value <= 1 + exactEpsilon, `${token} gives ${value}`);
    }
    for (const value of samples('spring')) assert.ok(value <= 1 + springOvershootCap + exactEpsilon, `spring gives ${value}`);
  });
});

describe('the canonical spring', () => {
  it('peaks between 1.02 and 1.04 and is exactly 1 at t = 1', () => {
    const peak = Math.max(...samples('spring'));
    assert.ok(peak >= 1.02 && peak <= 1.04, `peak ${peak}`);
    assert.equal(springEasing(1), 1);
  });

  it('settles after ln(1000) / (damping ratio × natural frequency) seconds', () => {
    const naturalFrequency = Math.sqrt(springStiffness / springMass);
    const expected = Math.log(1000) / (springDampingRatio * naturalFrequency);
    assert.ok(Math.abs(springSettleSeconds - expected) <= exactEpsilon, `settle ${springSettleSeconds}`);
    assert.ok(Math.abs(springSettleSeconds - 0.921) <= 0.001, `settle ${springSettleSeconds}`);
  });

  it('is within 0.1 percent of its target from the settle time on', () => {
    const settleEpsilon = 0.001;
    for (const seconds of [springSettleSeconds, springSettleSeconds * 1.5, springSettleSeconds * 3]) {
      assert.ok(Math.abs(springResponse(seconds) - 1) <= settleEpsilon, `response at ${seconds} s = ${springResponse(seconds)}`);
    }
  });

  it('starts at rest: 0 at and before the release', () => {
    assert.equal(springResponse(0), 0);
    assert.equal(springResponse(-1), 0);
  });
});
