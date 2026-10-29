import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cycArcSegments, cycMesh, cycObject, cycProfile, stageHalfWidthM } from '../../../src/lanes/blender/cyc-mesh.ts';
import type { Vector } from '../../../src/shared/contracts/blender-scene.ts';
import { cycRadiusM, floorY, wallDepthM, wallSizeM } from '../../../src/shared/three/stage.ts';

const bounds = { w: 0.08, h: 0.25, d: 0.08 };
const floorZ = floorY(bounds);
const epsilon = 1e-9;

/** The normal of a quad's first corner, (b − a) × (d − a), in Blender's axes. */
function quadNormal(vertices: readonly Vector[], face: readonly number[]): Vector {
  const [a, b, , d] = face.map((index) => vertices[index]);
  assert.ok(a !== undefined && b !== undefined && d !== undefined);
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ad = { x: d.x - a.x, y: d.y - a.y, z: d.z - a.z };
  return { x: ab.y * ad.z - ab.z * ad.y, y: ab.z * ad.x - ab.x * ad.z, z: ab.x * ad.y - ab.y * ad.x };
}

describe('cycMesh', () => {
  it('indexes a valid vertex from every face and makes one quad per profile segment', () => {
    const mesh = cycMesh(bounds);
    assert.equal(mesh.vertices.length, 2 * (cycArcSegments + 3));
    assert.equal(mesh.faces.length, cycArcSegments + 2);
    for (const face of mesh.faces) {
      assert.equal(face.length, 4);
      assert.equal(new Set(face).size, 4, `a face repeats a vertex: ${JSON.stringify(face)}`);
      for (const index of face) assert.ok(Number.isInteger(index) && index >= 0 && index < mesh.vertices.length, `vertex ${String(index)} does not exist`);
    }
  });

  it('puts the floor\'s vertices at the floor height on Blender\'s Z after the axis mapping, spanning 8 m along X', () => {
    const mesh = cycMesh(bounds);
    const floor = mesh.faces[0];
    assert.ok(floor !== undefined);
    for (const index of floor) {
      const vertex = mesh.vertices[index];
      assert.ok(vertex !== undefined);
      assert.ok(Math.abs(vertex.z - floorZ) < epsilon, `floor vertex ${String(index)} at z ${String(vertex.z)}, not ${String(floorZ)}`);
      assert.ok(Math.abs(Math.abs(vertex.x) - stageHalfWidthM) < epsilon);
    }
  });

  it('stands the wall 2.5 m behind the anchor on Blender\'s +Y, rising 4 m above the arc', () => {
    const mesh = cycMesh(bounds);
    const wall = mesh.faces[mesh.faces.length - 1];
    assert.ok(wall !== undefined);
    const vertices = wall.map((index) => mesh.vertices[index]);
    for (const vertex of vertices) {
      assert.ok(vertex !== undefined);
      assert.ok(Math.abs(vertex.y + wallDepthM) < epsilon, `wall vertex at y ${String(vertex.y)}`);
    }
    const top = Math.max(...vertices.map((vertex) => vertex?.z ?? Number.NaN));
    assert.ok(Math.abs(top - (floorZ + cycRadiusM + wallSizeM.heightM)) < epsilon, `wall top at ${String(top)}`);
  });

  it('winds every face counter-clockwise seen from the camera: the floor faces up and the wall faces -Y, the camera\'s side', () => {
    const mesh = cycMesh(bounds);
    const floor = mesh.faces[0];
    const wall = mesh.faces[mesh.faces.length - 1];
    assert.ok(floor !== undefined && wall !== undefined);
    assert.ok(quadNormal(mesh.vertices, floor).z > 0, 'the floor faces up');
    assert.ok(quadNormal(mesh.vertices, wall).y < 0, 'the wall faces the camera');
    for (const face of mesh.faces) {
      const normal = quadNormal(mesh.vertices, face);
      assert.ok(normal.z >= -epsilon && normal.y <= epsilon, `an arc face points away from the camera: ${JSON.stringify(normal)}`);
    }
  });

  it('draws the profile from the floor\'s near edge through the arc to the wall\'s top without repeating the arc\'s first point', () => {
    const profile = cycProfile(bounds);
    const first = profile[0];
    const edge = profile[1];
    const base = profile[cycArcSegments + 1];
    const top = profile[profile.length - 1];
    assert.ok(first !== undefined && edge !== undefined && base !== undefined && top !== undefined);
    assert.ok(first.z > edge.z && Math.abs(first.y - floorZ) < epsilon && Math.abs(edge.y - floorZ) < epsilon);
    assert.ok(Math.abs(base.z - wallDepthM) < epsilon && Math.abs(base.y - (floorZ + cycRadiusM)) < epsilon, `the arc ends at the wall's base: ${JSON.stringify(base)}`);
    assert.ok(Math.abs(top.z - wallDepthM) < epsilon && top.y > base.y);
  });

  it('is written as one explicit mesh object at the origin in the surface material', () => {
    const object = cycObject(bounds);
    assert.deepEqual([object.kind, object.material, object.parent, object.location], ['mesh', 'surface', null, { x: 0, y: 0, z: 0 }]);
    assert.equal(object.meshVertices.length, cycMesh(bounds).vertices.length);
    assert.equal(object.meshFaces.length, cycMesh(bounds).faces.length);
  });
});
