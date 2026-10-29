/**
 * The scene and its stage: the background in the look's colour, a floor
 * under the subject, a back wall and the quarter-cylinder cyclorama that
 * joins them (shared/three/stage.ts for the numbers), all in the look's
 * surface colour so the lit gradient on them is the rig's doing.
 */
import { Color, CylinderGeometry, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, Scene } from 'three';
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';
import { stageMaterial } from '../../shared/three/materials.ts';
import { cycRadiusM, cycSegments, floorSizeM, stageLayout, wallSizeM } from '../../shared/three/stage.ts';

/** A scene whose background is the look's background colour. */
export function createScene(spec: ShotPageSpec): Scene {
  const scene = new Scene();
  scene.background = new Color(spec.look.palette.background);
  return scene;
}

/** Adds the floor (at the given height), the wall and the cyclorama to the scene; the floor and the curve receive the key's shadow. */
export function buildStage(scene: Scene, spec: ShotPageSpec, floorYM: number): void {
  const parameters = stageMaterial(spec.look.palette);
  // Double-sided because the camera sees the inside of the cyclorama's curve, whose geometry normals point outward.
  const material = new MeshStandardMaterial({ color: parameters.color, roughness: parameters.roughness, metalness: parameters.metalness, side: DoubleSide });
  const layout = stageLayout(floorYM);

  const floor = new Mesh(new PlaneGeometry(floorSizeM, floorSizeM), material);
  // A plane faces +Z; turned a quarter back about X it faces +Y, the floor's up.
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(layout.floorCentre.x, layout.floorCentre.y, layout.floorCentre.z);
  floor.receiveShadow = true;
  scene.add(floor);

  const wall = new Mesh(new PlaneGeometry(wallSizeM.widthM, wallSizeM.heightM), material);
  wall.position.set(layout.wallCentre.x, layout.wallCentre.y, layout.wallCentre.z);
  wall.receiveShadow = true;
  scene.add(wall);

  // An open cylinder along X: its rim runs from straight down (theta π after the turn) to straight back (3π/2), the arc from the floor to the wall.
  const curve = new Mesh(new CylinderGeometry(cycRadiusM, cycRadiusM, floorSizeM, cycSegments, 1, true, Math.PI, Math.PI / 2), material);
  curve.rotation.z = Math.PI / 2;
  curve.position.set(layout.cycCentre.x, layout.cycCentre.y, layout.cycCentre.z);
  curve.receiveShadow = true;
  scene.add(curve);
}
