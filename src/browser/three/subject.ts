/**
 * The subject as a group of meshes at the anchor, one per part of
 * subject/primitives.ts (the same parts the blender lane will build), in
 * the look's body and cap materials. The group turns about +Y by the
 * frame's turntable angle; a shot whose primitive is none has an empty
 * group.
 */
import { BoxGeometry, CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, SphereGeometry, TorusGeometry } from 'three';
import type { BufferGeometry, Scene } from 'three';
import { toRadians } from '../../shared/camera/model.ts';
import type { CameraFrame } from '../../shared/camera/types.ts';
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';
import { subjectAnchor } from '../../shared/composition/framing.ts';
import { subjectParts } from '../../shared/subject/primitives.ts';
import type { PartMaterial, SubjectPart } from '../../shared/subject/primitives.ts';
import { subjectMaterial } from '../../shared/three/materials.ts';
import type { PhysicalParameters } from '../../shared/three/materials.ts';

/** The radial segments of a cylinder: smooth at an ECU. */
export const cylinderSegments = 64;

/** The sphere's width and height segments. */
export const sphereSegments = { width: 48, height: 32 } as const;

/** A MeshPhysicalMaterial from the shared parameters; the colour is an sRGB hex that three converts. */
export function physicalMaterial(parameters: PhysicalParameters): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: parameters.color,
    roughness: parameters.roughness,
    metalness: parameters.metalness,
    clearcoat: parameters.clearcoat,
    clearcoatRoughness: parameters.clearcoatRoughness,
  });
}

/** The geometry of a part; a torus already lies in the XY plane with its axis on +Z, which is the shared convention, so it needs no turn. */
function partGeometry(part: SubjectPart): BufferGeometry {
  switch (part.shape) {
    case 'box':
      return new BoxGeometry(part.size.x, part.size.y, part.size.z);
    case 'cylinder':
      return new CylinderGeometry(part.radiusM, part.radiusM, part.heightM, cylinderSegments);
    case 'sphere':
      return new SphereGeometry(part.radiusM, sphereSegments.width, sphereSegments.height);
    case 'capsule':
      return new CapsuleGeometry(part.radiusM, part.lengthM, 8, cylinderSegments);
    case 'torus':
      return new TorusGeometry(part.radiusM, part.tubeM, 32, cylinderSegments);
  }
}

/** The subject group: built once, turned per frame. */
export class Subject {
  private readonly group: Group;

  /** Builds one mesh per part of the shot's primitive and adds the group to the scene at the anchor. */
  constructor(scene: Scene, spec: ShotPageSpec) {
    this.group = new Group();
    this.group.position.set(subjectAnchor.x, subjectAnchor.y, subjectAnchor.z);
    const materials: Record<PartMaterial, MeshPhysicalMaterial> = {
      body: physicalMaterial(subjectMaterial('body', spec.look.palette)),
      cap: physicalMaterial(subjectMaterial('cap', spec.look.palette)),
    };
    for (const part of subjectParts(spec.shot.subject.primitive, spec.shot.subject.boundsM)) {
      const mesh = new Mesh(partGeometry(part), materials[part.material]);
      mesh.name = part.name;
      mesh.position.set(part.offset.x, part.offset.y, part.offset.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  /** Turns the subject about +Y by the frame's turntable angle. */
  update(frame: CameraFrame): void {
    this.group.rotation.y = toRadians(frame.subjectRotationDeg);
  }
}
