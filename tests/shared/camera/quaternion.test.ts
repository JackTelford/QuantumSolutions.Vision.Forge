import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conjugate, fromAxisAngle, fromBasis, identityQuaternion, multiply, normalize, rotateVector } from '../../../src/shared/camera/quaternion.ts';
import type { Quaternion } from '../../../src/shared/camera/types.ts';
import { vector3 } from '../../../src/shared/camera/vector.ts';
import { assertClose, assertVectorClose } from './fixtures.ts';

const epsilon = 1e-12;
const quarterTurn = Math.PI / 2;
const xAxis = vector3(1, 0, 0);
const yAxis = vector3(0, 1, 0);
const zAxis = vector3(0, 0, 1);

function quaternionLength(q: Quaternion): number {
  return Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
}

describe('quaternion', () => {
  it('rotates +Z onto +X with a quarter turn about +Y, by the right-hand rule', () => {
    const q = fromAxisAngle(yAxis, quarterTurn);
    assertVectorClose(rotateVector(q, zAxis), xAxis, epsilon, 'rotated');
    assertVectorClose(rotateVector(q, xAxis), vector3(0, 0, -1), epsilon, 'rotated x');
  });

  it('leaves a vector alone under the identity and under a rotation about itself', () => {
    assert.deepEqual(rotateVector(identityQuaternion, vector3(1, 2, 3)), { x: 1, y: 2, z: 3 });
    assertVectorClose(rotateVector(fromAxisAngle(yAxis, 1.234), yAxis), yAxis, epsilon, 'axis');
  });

  it('composes so that multiply(a, b) applies b first and then a', () => {
    const aboutY = fromAxisAngle(yAxis, quarterTurn);
    const aboutX = fromAxisAngle(xAxis, quarterTurn);
    const composed = multiply(aboutX, aboutY);
    const stepwise = rotateVector(aboutX, rotateVector(aboutY, zAxis));
    assertVectorClose(rotateVector(composed, zAxis), stepwise, epsilon, 'composed');
    assertVectorClose(stepwise, xAxis, epsilon, 'z through y then x');
  });

  it('undoes a rotation with its conjugate', () => {
    const q = fromAxisAngle(normalizeAxis(1, 2, 3), 0.7);
    const point = vector3(0.3, -0.4, 0.5);
    assertVectorClose(rotateVector(conjugate(q), rotateVector(q, point)), point, epsilon, 'round trip');
  });

  it('normalizes to unit length and turns the zero quaternion into the identity', () => {
    const scaled = normalize({ x: 0, y: 2, z: 0, w: 2 });
    assertClose(quaternionLength(scaled), 1, epsilon, 'length');
    assert.deepEqual(normalize({ x: 0, y: 0, z: 0, w: 0 }), identityQuaternion);
  });

  it('builds the identity from the world axes and recovers a half turn through every branch of the matrix conversion', () => {
    assert.deepEqual(fromBasis(xAxis, yAxis, zAxis), identityQuaternion);
    const halfTurns = [
      { name: 'about Y', right: vector3(-1, 0, 0), up: yAxis, back: vector3(0, 0, -1), axis: yAxis },
      { name: 'about X', right: xAxis, up: vector3(0, -1, 0), back: vector3(0, 0, -1), axis: xAxis },
      { name: 'about Z', right: vector3(-1, 0, 0), up: vector3(0, -1, 0), back: zAxis, axis: zAxis },
    ];
    for (const turn of halfTurns) {
      const q = fromBasis(turn.right, turn.up, turn.back);
      assertClose(quaternionLength(q), 1, epsilon, `${turn.name} length`);
      assertVectorClose(rotateVector(q, xAxis), turn.right, epsilon, `${turn.name} right`);
      assertVectorClose(rotateVector(q, yAxis), turn.up, epsilon, `${turn.name} up`);
      assertVectorClose(rotateVector(q, zAxis), turn.back, epsilon, `${turn.name} back`);
    }
  });

  it('round-trips an arbitrary rotation through its basis', () => {
    const q = fromAxisAngle(normalizeAxis(-2, 1, 0.5), 2.1);
    const rebuilt = fromBasis(rotateVector(q, xAxis), rotateVector(q, yAxis), rotateVector(q, zAxis));
    const point = vector3(0.1, 0.2, -0.3);
    assertVectorClose(rotateVector(rebuilt, point), rotateVector(q, point), 1e-9, 'rebuilt');
  });
});

function normalizeAxis(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const magnitude = Math.sqrt(x * x + y * y + z * z);
  return { x: x / magnitude, y: y / magnitude, z: z / magnitude };
}
