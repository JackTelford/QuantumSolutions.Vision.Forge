/**
 * The shared world (right-handed, +Y up, +Z toward the viewer) in Blender's
 * axes (right-handed, +Z up, +Y into the screen): the change of basis M
 * takes (x, y, z) to (x, −z, y), a rotation of +90 degrees about +X.
 * Positions and directions map through M. An object's rotation does not
 * conjugate: a camera, a light and a mesh keep their local conventions in
 * both worlds (a camera looks down its local −Z and holds its local +Y up
 * in three.js and in Blender alike), so the orientation Blender needs is
 * M applied after the shared rotation, q_blender = q_M · q, not
 * M · q · M⁻¹. With the identity shared rotation (a camera on +Z looking
 * toward the origin) this gives the 90-degree tilt that turns Blender's
 * default downward camera toward +Y, the mapped −Z. ADR 0008 decision 2
 * was corrected accordingly on 2026-10-29.
 */
import { multiply, normalize } from './quaternion.ts';
import type { Quaternion, Vector3 } from './types.ts';

/** The quaternion of the basis change: +90 degrees about +X. */
export const blenderBasisQuaternion: Quaternion = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

/** A shared-world point or direction in Blender's axes: (x, y, z) → (x, −z, y). */
export function toBlenderVector(v: Vector3): Vector3 {
  return { x: v.x, y: -v.z, z: v.y };
}

/** A shared-world orientation (local −Z forward, +Y up) as the Blender orientation with the same local conventions: q_M · q, normalised. */
export function toBlenderQuaternion(q: Quaternion): Quaternion {
  return normalize(multiply(blenderBasisQuaternion, q));
}

/** A Blender quaternion in Blender's (w, x, y, z) field order, as scene.json records it. */
export function blenderQuaternionFields(q: Quaternion): { readonly w: number; readonly x: number; readonly y: number; readonly z: number } {
  return { w: q.w, x: q.x, y: q.y, z: q.z };
}

/** Degrees to radians, for the scene document's rotation fields (the applier does no arithmetic). */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
