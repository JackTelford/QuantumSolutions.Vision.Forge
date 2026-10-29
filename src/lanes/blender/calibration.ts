/**
 * The calibration scene of ADR 0008 decision 2 as Blender objects: the
 * patches as explicit quads and the two spheres, laid out on the anchor's
 * camera-facing plane by src/shared/three/calibration-layout.ts (the
 * same placement the three lane uses, so a patch projects onto its frame
 * box) and mapped to Blender's axes. A patch is written as four corners
 * rather than a turned plane so no Euler angles are needed: the corners
 * are the centre plus the camera's right and up axes, and the one face is
 * wound counter-clockwise seen from the camera. The layout is taken from
 * the first frame to render; the calibration probe renders stills, so a
 * moving camera, which would drift the patches off their boxes, does not
 * arise. Pure.
 */
import { rotateVector } from '../../shared/camera/quaternion.ts';
import type { CameraFrame, Vector3 } from '../../shared/camera/types.ts';
import { add, scale } from '../../shared/camera/vector.ts';
import { calibrationScene } from '../../shared/calibration/scene.ts';
import type { Material, SceneObject, Vector } from '../../shared/contracts/blender-scene.ts';
import { calibrationLayout } from '../../shared/three/calibration-layout.ts';
import type { PatchPlacement, SpherePlacement } from '../../shared/three/calibration-layout.ts';
import { blenderPoint } from './axes.ts';
import { calibrationMaterialName, calibrationPatchMaterial, calibrationSphereMaterial } from './materials.ts';
import { roundSegments, sceneObject } from './subject.ts';

/** The four corners of a patch relative to its centre, in Blender's axes: left-bottom, right-bottom, right-top, left-top seen from the camera, which winds the face counter-clockwise toward it. */
export function patchCorners(placement: PatchPlacement): readonly Vector[] {
  const right = rotateVector(placement.rotation, { x: 1, y: 0, z: 0 });
  const up = rotateVector(placement.rotation, { x: 0, y: 1, z: 0 });
  const corner = (sx: number, sy: number): Vector3 => add(scale(right, (sx * placement.widthM) / 2), scale(up, (sy * placement.heightM) / 2));
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].map(blenderPoint);
}

/** A patch as an explicit one-face mesh at its centre. */
export function patchObject(placement: PatchPlacement): SceneObject {
  return sceneObject(placement.patch.id, 'mesh', blenderPoint(placement.centre), calibrationMaterialName(placement.patch.id), null, {
    shadeSmooth: false,
    meshVertices: [...patchCorners(placement)],
    meshFaces: [[0, 1, 2, 3]],
  });
}

/** A sphere as a uv-sphere at its centre. */
export function sphereObject(placement: SpherePlacement): SceneObject {
  return sceneObject(placement.sphere.id, 'uv-sphere', blenderPoint(placement.centre), calibrationMaterialName(placement.sphere.id), null, { radiusM: placement.radiusM, vertices: roundSegments });
}

/** The materials of the calibration scene, one per patch and sphere, in scene order. */
export function calibrationMaterials(): readonly Material[] {
  const materials: Material[] = [];
  for (const element of calibrationScene.elements) {
    if (element.kind === 'patch') materials.push(calibrationPatchMaterial(element));
    else if (element.kind === 'sphere') materials.push(calibrationSphereMaterial(element));
  }
  return materials;
}

/** The objects of the calibration scene for a camera frame and frame aspect: the patches and the spheres; the text line belongs to the html lane. */
export function calibrationObjects(frame: CameraFrame, aspect: number): readonly SceneObject[] {
  return calibrationLayout(calibrationScene.elements, frame, aspect).map((placement) => (placement.kind === 'patch' ? patchObject(placement) : sphereObject(placement)));
}
