/**
 * The subject of a product shot as Blender primitives: one object per
 * part of subject/primitives.ts (the same parts the three lane builds),
 * parented to an empty at the anchor whose rotation about Z carries the
 * turntable move per frame. A part's axis is the shared +Y, which the
 * basis change takes to Blender's +Z, so cylinders and spheres need no
 * turn; a torus faces the shared +Z, Blender's -Y, so it turns a quarter
 * about X. Sizes are in metres; a cube and a plane are unit primitives
 * scaled, which keeps every operator parameter a plain value. Pure.
 */
import { degreesToRadians } from '../../shared/camera/blender-axes.ts';
import type { CameraFrame, Vector3 } from '../../shared/camera/types.ts';
import { subjectAnchor } from '../../shared/composition/framing.ts';
import type { Empty, ObjectKind, RotationZKeyframe, SceneObject, Vector } from '../../shared/contracts/blender-scene.ts';
import type { Shot } from '../../shared/contracts/shot-spec.ts';
import { subjectParts } from '../../shared/subject/primitives.ts';
import type { SubjectPart } from '../../shared/subject/primitives.ts';
import { blenderPoint } from './axes.ts';
import { bakedFrame, keyframeFrames } from './camera.ts';
import { materialNames } from './materials.ts';

/** The name of the empty the subject's parts are parented to. */
export const turntableEmptyName = 'turntable';

/** The segments of a cylinder, a sphere's rings and a torus: smooth at an ECU, as the three lane's 64. */
export const roundSegments = 64;

/** The unit a cube or a plane primitive is created at before scaling. */
export const unitPrimitiveSizeM = 1;

const zero: Vector = { x: 0, y: 0, z: 0 };
const one: Vector = { x: 1, y: 1, z: 1 };

/** A shared-world size (width along X, height along Y, depth along Z) as a Blender scale: the height goes to Z and the depth to Y, no sign, since a scale is a magnitude. */
export function toBlenderScale(size: Vector3): Vector {
  return { x: size.x, y: size.z, z: size.y };
}

/** The fields every scene object carries, with the primitive parameters at their unused values: the kind's own fields are filled by the caller. */
export function sceneObject(name: string, kind: ObjectKind, location: Vector, material: string, parent: string | null, fields: Partial<SceneObject> = {}): SceneObject {
  return {
    name,
    kind,
    location,
    rotationEulerRad: zero,
    scale: one,
    material,
    parent,
    shadeSmooth: true,
    radiusM: 0,
    depthM: 0,
    vertices: 3,
    majorRadiusM: 0,
    minorRadiusM: 0,
    sizeM: 0,
    meshVertices: [],
    meshFaces: [],
    ...fields,
  };
}

/** The turntable empty at the anchor with the subject's rotation per frame to render, plus the neighbour past each end of the batch so the motion blur sees the turn (camera.ts keyframeFrames): the bake's degrees about the shared +Y as radians about Blender's +Z, the same axis after the basis change, so the sense is unchanged. */
export function turntableEmpty(camera: readonly CameraFrame[], frames: readonly number[]): Empty {
  const rotationZKeyframes: RotationZKeyframe[] = keyframeFrames(frames, camera).map((frame) => ({ frame, radians: degreesToRadians(bakedFrame(camera, frame).subjectRotationDeg) }));
  return { name: turntableEmptyName, location: blenderPoint(subjectAnchor), rotationZKeyframes };
}

/** The objects of one part, parented to the turntable: a capsule is a cylinder between two spheres, every other shape one primitive. */
export function partObjects(part: SubjectPart): readonly SceneObject[] {
  const material = materialNames[part.material];
  const location = blenderPoint(part.offset);
  const parent = turntableEmptyName;
  switch (part.shape) {
    case 'box':
      // A box is flat shaded: smoothing a cube's six faces bends its edges.
      return [sceneObject(part.name, 'cube', location, material, parent, { sizeM: unitPrimitiveSizeM, scale: toBlenderScale(part.size), shadeSmooth: false })];
    case 'cylinder':
      return [sceneObject(part.name, 'cylinder', location, material, parent, { radiusM: part.radiusM, depthM: part.heightM, vertices: roundSegments })];
    case 'sphere':
      return [sceneObject(part.name, 'uv-sphere', location, material, parent, { radiusM: part.radiusM, vertices: roundSegments })];
    case 'capsule': {
      const half = part.lengthM / 2;
      const end = (name: string, sign: number): SceneObject =>
        sceneObject(name, 'uv-sphere', blenderPoint({ x: part.offset.x, y: part.offset.y + sign * half, z: part.offset.z }), material, parent, { radiusM: part.radiusM, vertices: roundSegments });
      return [
        sceneObject(`${part.name}-tube`, 'cylinder', location, material, parent, { radiusM: part.radiusM, depthM: part.lengthM, vertices: roundSegments }),
        end(`${part.name}-top`, 1),
        end(`${part.name}-bottom`, -1),
      ];
    }
    case 'torus':
      // Blender's torus lies in its XY plane with its axis on Z; a quarter turn about X puts that axis on -Y, the shared +Z.
      return [sceneObject(part.name, 'torus', location, material, parent, { majorRadiusM: part.radiusM, minorRadiusM: part.tubeM, vertices: roundSegments, rotationEulerRad: { x: Math.PI / 2, y: 0, z: 0 } })];
  }
}

/** Every object of the shot's subject, in part order; none for the `none` primitive. */
export function subjectObjects(shot: Shot): readonly SceneObject[] {
  return subjectParts(shot.subject.primitive, shot.subject.boundsM).flatMap((part) => partObjects(part));
}
