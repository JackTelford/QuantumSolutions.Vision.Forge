/**
 * The calibration scene of ADR 0008 decision 2 in three: the patches of
 * calibration/scene.ts as planes facing the camera on the anchor's plane,
 * each sized and placed by shared/three/calibration-layout.ts so it
 * projects exactly onto its frame box, in its own sRGB colour and
 * perfectly rough; the two spheres at their roughness. They stand where
 * the subject would and are lit by the shot's rig, which is the point:
 * the gray card's measured YAVG sets the lane's light scalar. The text
 * line is the html lane's and is not built here. There is no stage: the
 * rest of the frame is scene.background, the look's background colour,
 * as in the html lane; under agx that colour itself passes through the
 * tone map, so there it is the look's background only approximately, as
 * ADR 0008 accepts.
 */
import { Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from 'three';
import type { Scene } from 'three';
import { calibrationScene } from '../../shared/calibration/scene.ts';
import type { CameraFrame } from '../../shared/camera/types.ts';
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';
import { calibrationLayout } from '../../shared/three/calibration-layout.ts';
import { calibrationPatchMaterial, calibrationSphereMaterial } from '../../shared/three/materials.ts';
import { physicalMaterial, sphereSegments } from './subject.ts';

/** The calibration meshes, one per patch or sphere, placed per frame from the camera. */
export class CalibrationStage {
  private readonly aspect: number;
  private readonly meshes: Map<string, Mesh>;

  /** Builds a unit plane per patch and a unit sphere per sphere; update() scales and places them. */
  constructor(scene: Scene, spec: ShotPageSpec) {
    this.aspect = spec.width / spec.height;
    this.meshes = new Map();
    for (const element of calibrationScene.elements) {
      let mesh: Mesh;
      if (element.kind === 'patch') {
        const parameters = calibrationPatchMaterial(element.hex);
        mesh = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: parameters.color, roughness: parameters.roughness, metalness: parameters.metalness }));
      } else if (element.kind === 'sphere') {
        mesh = new Mesh(new SphereGeometry(1, sphereSegments.width, sphereSegments.height), physicalMaterial(calibrationSphereMaterial(element)));
        mesh.castShadow = true;
      } else {
        continue;
      }
      mesh.name = element.id;
      scene.add(mesh);
      this.meshes.set(element.id, mesh);
    }
    const first = spec.camera[0];
    if (first !== undefined) this.update(first);
  }

  /** Places every patch and sphere for the camera of the frame, so a moving camera keeps them on their boxes. */
  update(frame: CameraFrame): void {
    for (const placement of calibrationLayout(calibrationScene.elements, frame, this.aspect)) {
      const id = placement.kind === 'patch' ? placement.patch.id : placement.sphere.id;
      const mesh = this.meshes.get(id);
      if (mesh === undefined) continue;
      mesh.position.set(placement.centre.x, placement.centre.y, placement.centre.z);
      if (placement.kind === 'patch') {
        mesh.scale.set(placement.widthM, placement.heightM, 1);
        mesh.quaternion.set(placement.rotation.x, placement.rotation.y, placement.rotation.z, placement.rotation.w);
      } else {
        mesh.scale.setScalar(placement.radiusM);
      }
    }
  }
}
