/**
 * The baked camera as a CSS 3D transform for the html lane's 2.5D stage.
 *
 * The stage is a `preserve-3d` element whose origin sits at the centre of
 * the viewport with `transform-origin: 0 0 0`; its layers are positioned in
 * pixels with +x right, +y down and +z toward the viewer (the CSS
 * convention), at `pxPerMetre` pixels per world metre, so a layer at world
 * (x, y, z) sits at (x·u, −y·u, z·u). The viewport carries
 * `perspective: <perspectivePx>px` with `perspective-origin: 50% 50%`, which
 * puts the eye perspectivePx in front of the stage plane.
 *
 * The matrix takes a layer point e = (u·w.x, −u·w.y, u·w.z) to
 * (u·c.x, −u·c.y, u·c.z + p), where c is the point in camera space (local
 * −Z forward) and p the perspective; CSS then projects it to
 * (X·p / (p − Z), Y·p / (p − Z)) = (c.x·p / depth, −c.y·p / depth), which is
 * the pinhole projection of project.ts in pixels, because
 * p = height / (2·tan(vfov / 2)) = height·focal / sensorHeight. The scale u
 * cancels, so it is fixed from the base pose (u = p0 / baseDistance: at the
 * base pose a layer on the subject plane renders at scale 1) while the
 * perspective follows the frame's focal length, which is how a zoom and a
 * dolly differ on the stage.
 */
import { cssPerspectivePx } from './model.ts';
import { conjugate } from './quaternion.ts';
import type { CameraFrame, Quaternion, RenderSpec, Vector3 } from './types.ts';

/** A 4x4 matrix as 16 numbers in row-major order: m[row * 4 + column]. */
export type Matrix4 = readonly number[];

/** What the html lane applies per frame. */
export interface StageTransform {
  /** The viewport's `perspective` in CSS pixels for the frame's focal length. */
  readonly perspectivePx: number;
  /** The stage's `transform: matrix3d(...)` arguments: 16 numbers in CSS (column-major) order. */
  readonly matrix3d: readonly number[];
  /** Pixels per world metre the layers are laid out in. */
  readonly pxPerMetre: number;
}

/** The identity matrix. */
export const identityMatrix4: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The product a·b of two row-major 4x4 matrices (apply b first, then a, to a column vector). */
export function multiplyMatrix4(a: Matrix4, b: Matrix4): Matrix4 {
  const out: number[] = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[row * 4 + k] ?? 0) * (b[k * 4 + column] ?? 0);
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

/** The row-major translation matrix. */
export function translationMatrix4(x: number, y: number, z: number): Matrix4 {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

/** The row-major scale matrix. */
export function scaleMatrix4(x: number, y: number, z: number): Matrix4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

/** The row-major rotation matrix of a unit quaternion (local to world). */
export function rotationMatrix4(q: Quaternion): Matrix4 {
  const { x, y, z, w } = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}

/** Applies a row-major matrix to a point (w = 1), dropping the homogeneous coordinate. */
export function transformPoint(m: Matrix4, p: Vector3): Vector3 {
  return {
    x: (m[0] ?? 0) * p.x + (m[1] ?? 0) * p.y + (m[2] ?? 0) * p.z + (m[3] ?? 0),
    y: (m[4] ?? 0) * p.x + (m[5] ?? 0) * p.y + (m[6] ?? 0) * p.z + (m[7] ?? 0),
    z: (m[8] ?? 0) * p.x + (m[9] ?? 0) * p.y + (m[10] ?? 0) * p.z + (m[11] ?? 0),
  };
}

/** The 16 arguments of CSS `matrix3d()` for a row-major matrix: CSS lists columns first. */
export function toCssMatrix3d(m: Matrix4): readonly number[] {
  const out: number[] = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) out.push(m[row * 4 + column] ?? 0);
  }
  return out;
}

/** The world point of a stage layer point (px, y down) at `pxPerMetre`. */
export function stagePointToWorld(stagePx: Vector3, pxPerMetre: number): Vector3 {
  return { x: stagePx.x / pxPerMetre, y: -stagePx.y / pxPerMetre, z: stagePx.z / pxPerMetre };
}

/** The stage layer point (px, y down) of a world point at `pxPerMetre`. */
export function worldPointToStage(world: Vector3, pxPerMetre: number): Vector3 {
  return { x: world.x * pxPerMetre, y: -world.y * pxPerMetre, z: world.z * pxPerMetre };
}

/**
 * Pixels per world metre of the stage: the base pose's perspective divided
 * by its distance, so that at the base pose a layer on the subject's plane
 * renders at scale 1 and 1 m measures `height·focal / (sensorHeight·distance)` px.
 */
export function stagePxPerMetre(spec: RenderSpec, baseFocalMm: number, baseDistanceM: number): number {
  return cssPerspectivePx(baseFocalMm, spec.width / spec.height, spec.height) / baseDistanceM;
}

/**
 * The row-major stage matrix of a camera frame: Tz(p) · S · R⁻¹ · T(−position) · S⁻¹
 * with S = diag(u, −u, u), so a layer laid out in stage pixels lands where
 * the camera sees it, p pixels behind the eye along the view axis.
 */
export function stageMatrix(frame: CameraFrame, spec: RenderSpec, pxPerMetre: number): Matrix4 {
  const u = pxPerMetre;
  const p = cssPerspectivePx(frame.focalMm, spec.width / spec.height, spec.height);
  const toCamera = multiplyMatrix4(rotationMatrix4(conjugate(frame.rotation)), translationMatrix4(-frame.position.x, -frame.position.y, -frame.position.z));
  const inStagePixels = multiplyMatrix4(scaleMatrix4(u, -u, u), multiplyMatrix4(toCamera, scaleMatrix4(1 / u, -1 / u, 1 / u)));
  return multiplyMatrix4(translationMatrix4(0, 0, p), inStagePixels);
}

/** The perspective and the CSS matrix3d arguments the html lane sets for a frame. */
export function stageTransform(frame: CameraFrame, spec: RenderSpec, pxPerMetre: number): StageTransform {
  return {
    perspectivePx: cssPerspectivePx(frame.focalMm, spec.width / spec.height, spec.height),
    matrix3d: toCssMatrix3d(stageMatrix(frame, spec, pxPerMetre)),
    pxPerMetre,
  };
}

/**
 * Where CSS draws a stage layer point for a frame, in pixels from the
 * viewport centre (y down), or null when the point is at or behind the
 * eye: the matrix followed by the perspective divide, as the browser does
 * it. Tests hold it to project.ts; the lane never needs it.
 */
export function cssProjectedPoint(stagePx: Vector3, frame: CameraFrame, spec: RenderSpec, pxPerMetre: number): { readonly x: number; readonly y: number } | null {
  const p = cssPerspectivePx(frame.focalMm, spec.width / spec.height, spec.height);
  const v = transformPoint(stageMatrix(frame, spec, pxPerMetre), stagePx);
  const denominator = p - v.z;
  if (denominator <= 0) return null;
  return { x: (v.x * p) / denominator, y: (v.y * p) / denominator };
}

/** The `transform` value of a layer at a stage point: a translate3d in pixels, with 3 decimals. */
export function layerTransform(stagePx: Vector3): string {
  return `translate3d(${stagePx.x.toFixed(3)}px, ${stagePx.y.toFixed(3)}px, ${stagePx.z.toFixed(3)}px)`;
}

/** The `transform` value of the stage: `matrix3d(...)` with 6 decimals per entry. */
export function stageTransformValue(transform: StageTransform): string {
  return `matrix3d(${transform.matrix3d.map((entry) => entry.toFixed(6)).join(', ')})`;
}
