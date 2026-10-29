/**
 * The stage of a product shot as one explicit mesh: the floor under the
 * subject, the quarter-circle cyclorama rising from its far edge and the
 * back wall above it, the same three pieces and dimensions as the three
 * lane's stage (src/shared/three/stage.ts) so both lanes show one set. The
 * profile is drawn in the shared world (+Y up, the camera on +Z) from the
 * camera side toward the wall and extruded along X; every vertex then
 * maps to Blender's axes through camera/blender-axes.ts. Faces are quads
 * wound counter-clockwise seen from the camera side, so their normals
 * point up from the floor and toward the camera from the wall. Pure.
 */
import type { Vector3 } from '../../shared/camera/types.ts';
import type { SceneObject, Vector } from '../../shared/contracts/blender-scene.ts';
import type { BoundsM } from '../../shared/contracts/shot-spec.ts';
import { cycRadiusM, floorSizeM, floorY, stageLayout, wallSizeM } from '../../shared/three/stage.ts';
import { blenderPoint } from './axes.ts';
import { materialNames } from './materials.ts';

/** The segments of the quarter arc between the floor and the wall. */
export const cycArcSegments = 16;

/** Half the stage's width along X, in metres: the floor and the wall span -4 to +4. */
export const stageHalfWidthM = floorSizeM / 2;

/** The name of the stage object. */
export const cycObjectName = 'cyc';

/** The explicit mesh of the stage: vertices in Blender's axes relative to the origin, and faces as vertex index lists. */
export interface CycMesh {
  readonly vertices: readonly Vector[];
  readonly faces: readonly (readonly number[])[];
}

/**
 * The stage profile in the shared world's (y, z) plane, in order from the
 * camera side: the floor's near edge, its far edge where the curve starts,
 * the arc's points up to the wall's base, then the wall's top. The floor's
 * far edge is the arc's first point, so it appears once.
 */
export function cycProfile(bounds: BoundsM): readonly { readonly y: number; readonly z: number }[] {
  const y = floorY(bounds);
  const layout = stageLayout(y);
  const curveStartZ = layout.cycCentre.z;
  const profile: { y: number; z: number }[] = [{ y, z: curveStartZ + floorSizeM }];
  for (let segment = 0; segment <= cycArcSegments; segment += 1) {
    // The arc is centred one radius above the floor's far edge; angle 0 is the floor's edge, 90 degrees the wall's base.
    const angle = (Math.PI / 2) * (segment / cycArcSegments);
    profile.push({ y: layout.cycCentre.y - cycRadiusM * Math.cos(angle), z: curveStartZ - cycRadiusM * Math.sin(angle) });
  }
  profile.push({ y: y + cycRadiusM + wallSizeM.heightM, z: layout.wallCentre.z });
  return profile;
}

/**
 * The stage mesh for a subject of the given bounds: each profile point
 * becomes two vertices, at x = -4 and x = +4, and each consecutive pair of
 * profile points one quad. For the quad between profile points i and
 * i + 1 the order left-near, right-near, right-far, left-far is
 * counter-clockwise seen from above the floor and from in front of the
 * wall, so the normals face the camera.
 */
export function cycMesh(bounds: BoundsM): CycMesh {
  const vertices: Vector[] = [];
  const faces: number[][] = [];
  const profile = cycProfile(bounds);
  for (const point of profile) {
    const left: Vector3 = { x: -stageHalfWidthM, y: point.y, z: point.z };
    const right: Vector3 = { x: stageHalfWidthM, y: point.y, z: point.z };
    vertices.push(blenderPoint(left), blenderPoint(right));
  }
  for (let index = 0; index < profile.length - 1; index += 1) {
    const nearLeft = 2 * index;
    faces.push([nearLeft, nearLeft + 1, nearLeft + 3, nearLeft + 2]);
  }
  return { vertices, faces };
}

/** The stage as a scene object: an explicit mesh at the origin in the surface material, shaded smooth so the arc's 16 facets read as one curve; the floor and the wall are flat anyway, and the mesh has no sharp corner to blur. */
export function cycObject(bounds: BoundsM): SceneObject {
  const mesh = cycMesh(bounds);
  return {
    name: cycObjectName,
    kind: 'mesh',
    location: { x: 0, y: 0, z: 0 },
    rotationEulerRad: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    material: materialNames.surface,
    parent: null,
    shadeSmooth: true,
    radiusM: 0,
    depthM: 0,
    vertices: 3,
    majorRadiusM: 0,
    minorRadiusM: 0,
    sizeM: 0,
    meshVertices: [...mesh.vertices],
    meshFaces: mesh.faces.map((face) => [...face]),
  };
}
