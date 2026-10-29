import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { degreesToRadians, toBlenderQuaternion, toBlenderVector } from '../../../src/shared/camera/blender-axes.ts';
import { lookAtQuaternion } from '../../../src/shared/camera/placement.ts';
import { identityQuaternion, rotateVector } from '../../../src/shared/camera/quaternion.ts';
import type { Vector3 } from '../../../src/shared/camera/types.ts';
import { vector3 } from '../../../src/shared/camera/vector.ts';

const epsilon = 1e-9;

function assertVector(actual: Vector3, expected: Vector3, label: string): void {
  assert.ok(Math.abs(actual.x - expected.x) < epsilon && Math.abs(actual.y - expected.y) < epsilon && Math.abs(actual.z - expected.z) < epsilon, `${label}: ${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`);
}

describe('Blender axes', () => {
  it('maps up to +Z and toward-the-viewer to -Y', () => {
    assertVector(toBlenderVector(vector3(0, 1, 0)), vector3(0, 0, 1), 'up');
    assertVector(toBlenderVector(vector3(0, 0, 1)), vector3(0, -1, 0), 'toward the viewer');
    assertVector(toBlenderVector(vector3(1, 0, 0)), vector3(1, 0, 0), 'right');
    assertVector(toBlenderVector(vector3(0, 0.3, 2.2)), vector3(0, -2.2, 0.3), 'the eye-level camera position');
  });

  it('turns the identity camera (on +Z, looking at the origin) into a Blender camera looking along +Y with +Z up', () => {
    const blender = toBlenderQuaternion(identityQuaternion);
    assertVector(rotateVector(blender, vector3(0, 0, -1)), vector3(0, 1, 0), 'forward');
    assertVector(rotateVector(blender, vector3(0, 1, 0)), vector3(0, 0, 1), 'up');
  });

  it('keeps a look-at orientation consistent: Blender forward is the mapped shared forward for every camera position', () => {
    for (const position of [vector3(2, 0.5, 1), vector3(-1, 2, 0.2), vector3(0, 3, 0.001), vector3(0.4, -0.2, -2)]) {
      const shared = lookAtQuaternion(position, vector3(0, 0, 0), 7);
      const blender = toBlenderQuaternion(shared);
      assertVector(rotateVector(blender, vector3(0, 0, -1)), toBlenderVector(rotateVector(shared, vector3(0, 0, -1))), `forward from ${JSON.stringify(position)}`);
      assertVector(rotateVector(blender, vector3(0, 1, 0)), toBlenderVector(rotateVector(shared, vector3(0, 1, 0))), `up from ${JSON.stringify(position)}`);
    }
  });

  it('converts degrees to radians', () => {
    assert.ok(Math.abs(degreesToRadians(180) - Math.PI) < epsilon);
  });
});
