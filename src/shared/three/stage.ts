/**
 * The three lane's stage as numbers: a floor under the subject, a back
 * wall and the quarter-cylinder cyclorama that joins them without a
 * visible corner, plus the fog density of the shot's haze. All in the
 * look's surface colour (materials.ts) so the lit gradient is the lights'
 * work. World space is camera/types.ts': the anchor at the origin, +Y up,
 * the camera on +Z by default.
 */
import type { Vector3 } from '../camera/types.ts';
import type { BoundsM } from '../contracts/shot-spec.ts';

/** The floor's side in metres. */
export const floorSizeM = 8;

/** The back wall's width and height in metres. */
export const wallSizeM = { widthM: 8, heightM: 4 } as const;

/** The back wall's depth behind the anchor, in metres (negative z). */
export const wallDepthM = -2.5;

/** The radius of the cyclorama's curve between the floor and the wall, in metres. */
export const cycRadiusM = 0.6;

/** The cyclorama's radial segments. */
export const cycSegments = 32;

/** The fog density per unit of haze: FogExp2 at haze 1 leaves e^-(0.35·d)² of a surface d metres away. */
export const fogDensityPerHaze = 0.35;

/** Where the three pieces of the stage sit for a subject of the given bounds. */
export interface StageLayout {
  /** The floor plane's centre: at the subject's base, moved back so its far edge meets the cyclorama's curve. */
  readonly floorCentre: Vector3;
  /** The back wall's centre: standing on the curve's top edge. */
  readonly wallCentre: Vector3;
  /** The axis of the quarter cylinder (parallel to X): above the floor's far edge by its radius. */
  readonly cycCentre: Vector3;
}

/** The floor's height in world space: the bottom face of the subject's bounds. */
export function floorY(bounds: BoundsM): number {
  return -bounds.h / 2;
}

/**
 * The stage layout: the floor ends at wallDepth + radius, where the curve
 * takes over and rises to wallDepth at floor + radius, where the wall
 * starts. The floor plane is centred so its far edge is that line.
 */
export function stageLayout(bounds: BoundsM): StageLayout {
  const y = floorY(bounds);
  const curveStartZ = wallDepthM + cycRadiusM;
  return {
    floorCentre: { x: 0, y, z: curveStartZ + floorSizeM / 2 },
    wallCentre: { x: 0, y: y + cycRadiusM + wallSizeM.heightM / 2, z: wallDepthM },
    cycCentre: { x: 0, y: y + cycRadiusM, z: curveStartZ },
  };
}

/** The FogExp2 density for a shot's haze; 0 (no fog) when the haze is 0. */
export function fogDensity(haze: number): number {
  return Math.max(0, haze) * fogDensityPerHaze;
}
