import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoundsM, Primitive } from '../../../src/shared/contracts/shot-spec.ts';
import { PrimitiveValues } from '../../../src/shared/contracts/shot-spec.ts';
import { partHalfExtent, subjectParts } from '../../../src/shared/subject/primitives.ts';

const bottle: BoundsM = { w: 0.08, h: 0.25, d: 0.08 };
const wide: BoundsM = { w: 0.3, h: 0.1, d: 0.2 };
const epsilon = 1e-9;

describe('subjectParts', () => {
  it('has parts for every primitive but none, each inside the bounds', () => {
    for (const primitive of PrimitiveValues as readonly Primitive[]) {
      for (const bounds of [bottle, wide]) {
        const parts = subjectParts(primitive, bounds);
        assert.equal(parts.length === 0, primitive === 'none', `${primitive} parts`);
        for (const part of parts) {
          const half = partHalfExtent(part);
          assert.ok(Math.abs(part.offset.x) + half.x <= bounds.w / 2 + epsilon, `${primitive} ${part.name} x`);
          assert.ok(Math.abs(part.offset.y) + half.y <= bounds.h / 2 + epsilon, `${primitive} ${part.name} y`);
          assert.ok(Math.abs(part.offset.z) + half.z <= bounds.d / 2 + epsilon, `${primitive} ${part.name} z`);
        }
      }
    }
  });

  it('builds a bottle from a body, a narrower neck and a cap stacked to the full height', () => {
    const parts = subjectParts('bottle', bottle);
    assert.deepEqual(parts.map((part) => [part.name, part.shape, part.material]), [['body', 'cylinder', 'body'], ['neck', 'cylinder', 'body'], ['cap', 'cylinder', 'cap']]);
    const [body, neck, cap] = parts;
    assert.ok(body !== undefined && neck !== undefined && cap !== undefined);
    assert.ok(body.shape === 'cylinder' && neck.shape === 'cylinder' && cap.shape === 'cylinder');
    assert.ok(neck.radiusM < body.radiusM);
    assert.ok(Math.abs(body.offset.y - body.heightM / 2 - (-bottle.h / 2)) < epsilon, 'the body stands on the bottom of the bounds');
    assert.ok(Math.abs(cap.offset.y + cap.heightM / 2 - bottle.h / 2) < epsilon, 'the cap reaches the top of the bounds');
  });

  it('gives a pill a capsule as tall as the bounds and a sphere the smallest dimension', () => {
    const pill = subjectParts('pill', bottle)[0];
    assert.ok(pill !== undefined && pill.shape === 'capsule');
    assert.ok(Math.abs(pill.lengthM + 2 * pill.radiusM - bottle.h) < epsilon);
    const sphere = subjectParts('sphere', wide)[0];
    assert.ok(sphere !== undefined && sphere.shape === 'sphere');
    assert.equal(sphere.radiusM, 0.05);
  });

  it('fits a torus to the smaller of width and height with its tube inside the depth', () => {
    const torus = subjectParts('torus', wide)[0];
    assert.ok(torus !== undefined && torus.shape === 'torus');
    assert.ok(Math.abs(torus.radiusM + torus.tubeM - 0.05) < epsilon);
    assert.ok(torus.tubeM <= wide.d / 2);
  });
});
