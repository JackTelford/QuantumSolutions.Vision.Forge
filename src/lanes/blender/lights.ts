/**
 * The rig as Blender area lights (lighting/cookbook.md, the per-lane
 * mapping): one square area light per placed light of the rig
 * (lighting/placement.ts), its power in watts from the irradiance rule of
 * ADR 0008 decision 2 and its colour balanced to the rig's key, aimed at
 * the anchor, with the key and the fill keyframed per frame for the
 * light-sweep move while the rims stay. Pure functions of the shot, the
 * bake and the frames to render.
 */
import { toBlenderQuaternion } from '../../shared/camera/blender-axes.ts';
import { lookAtQuaternion } from '../../shared/camera/placement.ts';
import type { CameraFrame, Quaternion } from '../../shared/camera/types.ts';
import { distance } from '../../shared/camera/vector.ts';
import { blenderCalibrationDistanceM, blenderKeyPowerW } from '../../shared/blender/calibration-scalars.ts';
import { rgb255ToLinear } from '../../shared/color/srgb.ts';
import type { LinearRgb } from '../../shared/color/srgb.ts';
import type { AreaLight, LocationKeyframe, Quaternion as BlenderQuaternion } from '../../shared/contracts/blender-scene.ts';
import type { ToneMapping } from '../../shared/contracts/look-bible.ts';
import type { Shot } from '../../shared/contracts/shot-spec.ts';
import { cameraAzimuthDeg, placeRig } from '../../shared/lighting/placement.ts';
import type { PlacedLight, PlacedRig } from '../../shared/lighting/placement.ts';
import { shotLightingRig } from '../../shared/lighting/rigs.ts';
import { lightRgb } from '../../shared/look/css-tokens.ts';
import { placedRigWhiteBalanceKelvin } from '../../shared/three/lights.ts';
import { blenderPoint, blenderRotation } from './axes.ts';
import { bakedFrame, keyframeFrames } from './camera.ts';

/** Blender's range for a light's colour temperature; a kelvin outside it is clamped, since the field is a record only (the colour is written balanced). */
export const blenderTemperatureRangeK = { min: 800, max: 12000 } as const;

/** The placed lights of a rig in a fixed order: key, fill, then the rims; the same order the three lane adds them in. */
export function placedLightsOf(rig: PlacedRig): readonly PlacedLight[] {
  const lights: PlacedLight[] = [];
  if (rig.key !== null) lights.push(rig.key);
  if (rig.fill !== null) lights.push(rig.fill);
  lights.push(...rig.rims);
  return lights;
}

/** The rig placed for a frame: at the camera's azimuth from frame 0 of the bake, the subject's height, and the frame's key orbit. */
export function placedRigAt(shot: Shot, camera: readonly CameraFrame[], frame: CameraFrame): PlacedRig {
  return placeRig(shotLightingRig(shot.lighting), cameraAzimuthDeg(bakedFrame(camera, 0).position), shot.subject.boundsM.h, frame.keyLightOrbitDeg);
}

/**
 * The power in watts of a placed light: its relative intensity times the
 * key power of the look's tone mapping, scaled by (d / 1.2)² for its
 * distance d to the target. The relative intensity is an irradiance on
 * the subject; Blender spreads a light's power over its area already, so
 * the distance alone enters, calibrated at 1.2 m where the bottle
 * fixture's lights stand (blender/calibration-scalars.ts).
 */
export function areaLightPowerW(light: Pick<PlacedLight, 'intensity' | 'position' | 'target'>, toneMapping: ToneMapping): number {
  const ratio = distance(light.position, light.target) / blenderCalibrationDistanceM;
  return light.intensity * blenderKeyPowerW[toneMapping] * ratio * ratio;
}

/** The colour of a placed light in linear light: its tint, or its black-body colour balanced to the rig's key (css-tokens.ts lightRgb), decoded from sRGB as the three lane decodes it. */
export function areaLightColour(light: Pick<PlacedLight, 'tint' | 'kelvin'>, whiteBalanceKelvin: number): LinearRgb {
  return rgb255ToLinear(lightRgb(light, whiteBalanceKelvin));
}

/** The orientation of a light facing its target in Blender's axes: an area light emits along its local -Z like a camera looks, so the camera's look-at orientation serves, mapped through the basis change. */
export function areaLightAim(light: Pick<PlacedLight, 'position' | 'target'>): Quaternion {
  return toBlenderQuaternion(lookAtQuaternion(light.position, light.target, 0));
}

/** The light's aim as the document writes it. */
function aimFields(light: Pick<PlacedLight, 'position' | 'target'>): BlenderQuaternion {
  return blenderRotation(lookAtQuaternion(light.position, light.target, 0));
}

/** A light's kelvin inside Blender's accepted range. */
export function clampedTemperatureK(kelvin: number): number {
  return Math.min(blenderTemperatureRangeK.max, Math.max(blenderTemperatureRangeK.min, kelvin));
}

/** One location keyframe: where a light stands and faces at a frame. */
function locationKeyframe(frame: number, light: PlacedLight): LocationKeyframe {
  return { frame, location: blenderPoint(light.position), rotationQuaternion: aimFields(light) };
}

/**
 * The area lights of a shot for the frames to render. Every light stands
 * where the first frame's placement puts it; the key and the fill, which
 * the light-sweep move orbits, also carry one keyframe per frame, plus
 * the neighbour past each end of the batch (camera.ts keyframeFrames), so
 * the sweep renders and motion blur sees it; the rims never move and
 * carry none. Colours are balanced to the rig's key
 * (placedRigWhiteBalanceKelvin), so the key renders neutral and the lanes
 * agree on neutrals; use_temperature is off and the kelvin is kept as a
 * record.
 */
export function areaLights(shot: Shot, camera: readonly CameraFrame[], frames: readonly number[], toneMapping: ToneMapping): readonly AreaLight[] {
  const first = frames[0];
  if (first === undefined) throw new RangeError('A Blender scene renders at least one frame.');
  const placedFirst = placedRigAt(shot, camera, bakedFrame(camera, first));
  const whiteBalanceKelvin = placedRigWhiteBalanceKelvin(placedFirst);
  const keyed = keyframeFrames(frames, camera);
  const perFrame = keyed.map((frame) => placedRigAt(shot, camera, bakedFrame(camera, frame)));
  return placedLightsOf(placedFirst).map((light) => {
    const moves = light.name === 'key' || light.name === 'fill';
    const keyframes: LocationKeyframe[] = [];
    if (moves) {
      perFrame.forEach((placed, index) => {
        const frame = keyed[index];
        const moved = placedLightsOf(placed).find((candidate) => candidate.name === light.name);
        if (frame !== undefined && moved !== undefined) keyframes.push(locationKeyframe(frame, moved));
      });
    }
    return {
      name: light.name,
      shape: 'SQUARE',
      sizeM: light.sizeM,
      sizeYM: light.sizeM,
      powerW: areaLightPowerW(light, toneMapping),
      useTemperature: false,
      temperatureK: clampedTemperatureK(light.kelvin),
      color: areaLightColour(light, whiteBalanceKelvin),
      location: blenderPoint(light.position),
      rotationQuaternion: aimFields(light),
      locationKeyframes: keyframes,
    };
  });
}
