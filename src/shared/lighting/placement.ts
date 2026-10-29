/**
 * Where a lighting rig's lights stand in world space. The cookbook measures
 * azimuth around the subject from the camera (0 behind the camera, 90 at
 * camera-right, 180 behind the subject) and elevation above the subject's
 * centre, so a light's world azimuth is the camera's azimuth plus the
 * light's (world azimuth 0 is +Z and grows toward +X, the camera's right
 * when it stands on +Z, src/shared/camera/types.ts). Lights are placed on
 * a sphere whose radius grows with the subject, sized from the cookbook's
 * "diameter at one metre of subject height", and the fill stands opposite
 * the key, low, unless the rig names its own azimuth. The three lane maps
 * the result to RectAreaLights; the blender lane to area lights.
 */
import { sphericalAngles, sphericalPoint } from '../camera/placement.ts';
import type { Vector3 } from '../camera/types.ts';
import { subjectAnchor } from '../composition/framing.ts';
import type { LightingRig, RigLight } from './rigs.ts';

/** A light placed in the world: its centre, the point it faces, its size, colour and strength. */
export interface PlacedLight {
  readonly name: string;
  readonly position: Vector3;
  /** The point the light faces: the subject's anchor. */
  readonly target: Vector3;
  /** The light's width and height in metres (a square softbox). */
  readonly sizeM: number;
  readonly kelvin: number;
  /** A hex tint that replaces the Kelvin colour, or null. */
  readonly tint: string | null;
  /** Relative strength: 1 is the rig's key. */
  readonly intensity: number;
}

/** The placed lights of a rig. */
export interface PlacedRig {
  readonly key: PlacedLight | null;
  readonly fill: PlacedLight | null;
  readonly rims: readonly PlacedLight[];
  /** Strength of the environment light relative to the key, from the rig's fill ratio when it has no placed fill. */
  readonly ambient: number;
}

/** Light distance as a multiple of the subject's height. */
export const lightDistanceMultiple = 3;

/** The nearest a light stands to the subject's anchor, in metres, whatever the subject's size. */
export const minimumLightDistanceM = 1.2;

/** The fill's elevation when the rig does not name one. */
export const fillElevationDeg = 15;

/** The fill's size relative to the key's. */
export const fillSizeMultiple = 2;

/** The world azimuth of the camera as seen from the anchor, from its position. */
export function cameraAzimuthDeg(cameraPosition: Vector3): number {
  return sphericalAngles(subjectAnchor, cameraPosition).azimuthDeg;
}

/** How far the rig's lights stand from the anchor for a subject of the given height. */
export function lightDistanceM(subjectHeightM: number): number {
  return Math.max(minimumLightDistanceM, subjectHeightM * lightDistanceMultiple);
}

/** The size of a light in metres for a subject height: the cookbook's diameter is per metre of subject height. */
export function lightSizeM(light: RigLight, subjectHeightM: number): number {
  return light.sizeM * subjectHeightM;
}

/** The world position of a light of the rig: on the light sphere at the camera's azimuth plus the light's, at the light's elevation. */
export function lightWorldPosition(light: Pick<RigLight, 'azimuthDeg' | 'elevationDeg'>, cameraAzimuth: number, subjectHeightM: number, orbitDeg = 0): Vector3 {
  return sphericalPoint(subjectAnchor, lightDistanceM(subjectHeightM), cameraAzimuth + light.azimuthDeg + orbitDeg, light.elevationDeg);
}

function place(name: string, light: RigLight, cameraAzimuth: number, subjectHeightM: number, orbitDeg: number): PlacedLight {
  return {
    name,
    position: lightWorldPosition(light, cameraAzimuth, subjectHeightM, orbitDeg),
    target: subjectAnchor,
    sizeM: lightSizeM(light, subjectHeightM),
    kelvin: light.kelvin,
    tint: light.tint,
    intensity: light.intensity,
  };
}

/**
 * Places every light of a rig for a camera azimuth and a subject height.
 * The key orbit (the light-sweep move) turns the key and the fill together
 * so their relationship holds; the rims stay. A rig without a key has no
 * fill either: its fill ratio becomes the ambient strength instead.
 */
export function placeRig(rig: LightingRig, cameraAzimuth: number, subjectHeightM: number, keyOrbitDeg = 0): PlacedRig {
  if (rig.key === null) {
    return { key: null, fill: null, rims: rig.rims.map((rim, index) => place(`rim-${index + 1}`, rim, cameraAzimuth, subjectHeightM, 0)), ambient: 1 / rig.fillRatio };
  }
  const key = place('key', rig.key, cameraAzimuth, subjectHeightM, keyOrbitDeg);
  const fillLight: RigLight = {
    azimuthDeg: rig.fill?.azimuthDeg ?? -rig.key.azimuthDeg,
    elevationDeg: fillElevationDeg,
    sizeM: rig.key.sizeM * fillSizeMultiple,
    kelvin: rig.fill?.kelvin ?? rig.key.kelvin,
    intensity: rig.key.intensity / rig.fillRatio,
    tint: null,
  };
  const fill = place('fill', fillLight, cameraAzimuth, subjectHeightM, keyOrbitDeg);
  return { key, fill, rims: rig.rims.map((rim, index) => place(`rim-${index + 1}`, rim, cameraAzimuth, subjectHeightM, 0)), ambient: 0 };
}
