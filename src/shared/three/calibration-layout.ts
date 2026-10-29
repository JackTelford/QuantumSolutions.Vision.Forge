/**
 * Where the calibration scene's patches and spheres stand in the world so
 * that each projects exactly onto its frame box (calibration/scene.ts)
 * through the shot's camera (ADR 0008 decision 2). Every element lies on
 * the plane through the subject's anchor that faces the camera: at the
 * anchor's depth d the frame is d × sensorWidth / focal metres wide and
 * d × sensorHeight / focal high (the pinhole of camera/model.ts and
 * project.ts), so a box's size and centre scale from frame fractions to
 * metres along the camera's right and up axes. Pure arithmetic; the test
 * projects the result back through project().
 */
import { sensorHeightMm, sensorWidthMm } from '../camera/model.ts';
import { conjugate, rotateVector } from '../camera/quaternion.ts';
import type { CameraFrame, Quaternion, Vector3 } from '../camera/types.ts';
import { add, subtract } from '../camera/vector.ts';
import type { CalibrationElement, CalibrationPatch, CalibrationSphere } from '../calibration/scene.ts';
import { subjectAnchor } from '../composition/framing.ts';

/** A patch as a plane in the world: its centre, its size in metres and the rotation that faces it at the camera. */
export interface PatchPlacement {
  readonly kind: 'patch';
  readonly patch: CalibrationPatch;
  readonly centre: Vector3;
  readonly widthM: number;
  readonly heightM: number;
  readonly rotation: Quaternion;
}

/** A sphere in the world: its centre on the anchor's plane and its radius from the box's height. */
export interface SpherePlacement {
  readonly kind: 'sphere';
  readonly sphere: CalibrationSphere;
  readonly centre: Vector3;
  readonly radiusM: number;
}

/** One placed element; the text line is not placed, it belongs to the html lane. */
export type CalibrationPlacement = PatchPlacement | SpherePlacement;

/** The frame's size in metres on the camera-facing plane through the anchor, and the anchor's depth. */
export function framePlaneAtAnchor(frame: CameraFrame, aspect: number): { readonly depthM: number; readonly widthM: number; readonly heightM: number } {
  const local = rotateVector(conjugate(frame.rotation), subtract(subjectAnchor, frame.position));
  const depthM = -local.z;
  return { depthM, widthM: (depthM * sensorWidthMm(aspect)) / frame.focalMm, heightM: (depthM * sensorHeightMm(aspect)) / frame.focalMm };
}

/** The world point on the anchor's plane that a frame fraction (x from the left, y from the top) projects from. */
export function framePointOnAnchorPlane(x: number, y: number, frame: CameraFrame, aspect: number): Vector3 {
  const plane = framePlaneAtAnchor(frame, aspect);
  const local: Vector3 = { x: (x - 0.5) * plane.widthM, y: (0.5 - y) * plane.heightM, z: -plane.depthM };
  return add(frame.position, rotateVector(frame.rotation, local));
}

/** Places the patches and spheres of the calibration scene for a camera frame; text elements are skipped. */
export function calibrationLayout(elements: readonly CalibrationElement[], frame: CameraFrame, aspect: number): readonly CalibrationPlacement[] {
  const plane = framePlaneAtAnchor(frame, aspect);
  const placements: CalibrationPlacement[] = [];
  for (const element of elements) {
    const centre = framePointOnAnchorPlane(element.box.x + element.box.w / 2, element.box.y + element.box.h / 2, frame, aspect);
    if (element.kind === 'patch') {
      placements.push({ kind: 'patch', patch: element, centre, widthM: element.box.w * plane.widthM, heightM: element.box.h * plane.heightM, rotation: frame.rotation });
    } else if (element.kind === 'sphere') {
      // The box's height is the silhouette's diameter; the sphere's cross-section on the plane is that size to within d² / (d² − r²).
      placements.push({ kind: 'sphere', sphere: element, centre, radiusM: (element.box.h * plane.heightM) / 2 });
    }
  }
  return placements;
}
