/**
 * Unit quaternions for camera orientation. A quaternion {x, y, z, w} with
 * unit axis a and angle θ is (a·sin(θ/2), cos(θ/2)); rotations compose by
 * multiplication and act on vectors by conjugation. Every function is pure.
 */
import type { Quaternion, Vector3 } from './types.ts';
import { add, cross, scale } from './vector.ts';

/** The identity rotation. */
export const identityQuaternion: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** The rotation of `angleRad` radians about the unit `axis`, by the right-hand rule. */
export function fromAxisAngle(axis: Vector3, angleRad: number): Quaternion {
  const half = angleRad / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

/** Hamilton product a·b: the rotation that applies b first, then a. */
export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** q scaled to unit length; the zero quaternion becomes the identity. */
export function normalize(q: Quaternion): Quaternion {
  const magnitude = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (magnitude === 0) return identityQuaternion;
  return { x: q.x / magnitude, y: q.y / magnitude, z: q.z / magnitude, w: q.w / magnitude };
}

/** The inverse rotation of a unit quaternion (its conjugate). */
export function conjugate(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/**
 * Rotates v by the unit quaternion q: v' = v + w·t + u × t with u the
 * vector part and t = 2(u × v), the expanded form of q·v·q*.
 */
export function rotateVector(q: Quaternion, v: Vector3): Vector3 {
  const u: Vector3 = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

/**
 * The rotation whose local axes land on the given orthonormal world
 * directions: local +X on `right`, local +Y on `up`, local +Z on `back`
 * (the columns of the rotation matrix), converted by Shepperd's method,
 * which divides by the largest of the four candidate terms so no branch
 * loses precision.
 */
export function fromBasis(right: Vector3, up: Vector3, back: Vector3): Quaternion {
  const m00 = right.x;
  const m10 = right.y;
  const m20 = right.z;
  const m01 = up.x;
  const m11 = up.y;
  const m21 = up.z;
  const m02 = back.x;
  const m12 = back.y;
  const m22 = back.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return normalize({ x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s, w: s / 4 });
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalize({ x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s, w: (m21 - m12) / s });
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalize({ x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s, w: (m02 - m20) / s });
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalize({ x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4, w: (m10 - m01) / s });
}
