/**
 * Vector arithmetic in world space (metres). Every function is pure and
 * returns a new vector; nothing is mutated.
 */
import type { Vector3 } from './types.ts';

/** Builds a vector from its three components. */
export function vector3(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

/** The origin. */
export const zeroVector: Vector3 = { x: 0, y: 0, z: 0 };

/** World up, +Y. */
export const worldUp: Vector3 = { x: 0, y: 1, z: 0 };

/** The up reference of a camera looking straight down: -Z, the far side of the subject from the default viewpoint. */
export const overheadUpReference: Vector3 = { x: 0, y: 0, z: -1 };

/** a + b. */
export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** a - b: the vector from b to a. */
export function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** v scaled by the factor. */
export function scale(v: Vector3, factor: number): Vector3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

/** The Euclidean length of v, in the unit of its components. */
export function length(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** The distance between two points. */
export function distance(a: Vector3, b: Vector3): number {
  return length(subtract(a, b));
}

/** v with length 1; the zero vector stays zero rather than becoming NaN. */
export function normalize(v: Vector3): Vector3 {
  const magnitude = length(v);
  return magnitude === 0 ? zeroVector : scale(v, 1 / magnitude);
}

/** The dot product a · b. */
export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** The cross product a × b, perpendicular to both by the right-hand rule. */
export function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
