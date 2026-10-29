import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { add, cross, distance, dot, length, normalize, scale, subtract, vector3, zeroVector } from '../../../src/shared/camera/vector.ts';
import { assertClose, assertVectorClose } from './fixtures.ts';

const epsilon = 1e-12;

describe('vector', () => {
  it('adds, subtracts and scales component by component without touching its inputs', () => {
    const a = vector3(1, 2, 3);
    const b = vector3(10, 20, 30);
    assert.deepEqual(add(a, b), { x: 11, y: 22, z: 33 });
    assert.deepEqual(subtract(b, a), { x: 9, y: 18, z: 27 });
    assert.deepEqual(scale(a, 2), { x: 2, y: 4, z: 6 });
    assert.deepEqual(a, { x: 1, y: 2, z: 3 });
  });

  it('measures length and distance by Pythagoras', () => {
    assert.equal(length(vector3(3, 4, 0)), 5);
    assert.equal(distance(vector3(1, 1, 1), vector3(1, 1, 3)), 2);
  });

  it('normalizes to unit length and leaves the zero vector zero instead of NaN', () => {
    const unit = normalize(vector3(0, 3, 4));
    assertVectorClose(unit, { x: 0, y: 0.6, z: 0.8 }, epsilon, 'unit');
    assertClose(length(unit), 1, epsilon, 'length');
    assert.deepEqual(normalize(zeroVector), zeroVector);
  });

  it('takes the dot product and a right-handed cross product', () => {
    assert.equal(dot(vector3(1, 2, 3), vector3(4, 5, 6)), 32);
    assert.deepEqual(cross(vector3(1, 0, 0), vector3(0, 1, 0)), { x: 0, y: 0, z: 1 });
    assert.deepEqual(cross(vector3(0, 1, 0), vector3(1, 0, 0)), { x: 0, y: 0, z: -1 });
    assertVectorClose(cross(vector3(0, 0, -1), vector3(0, 1, 0)), { x: 1, y: 0, z: 0 }, 0, 'camera forward × up is right');
  });
});
