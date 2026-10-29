/**
 * The procedural stand-in of a subject as 3D parts: what the three lane
 * builds from geometry and what the blender lane will write into
 * scene.json, so both lanes show the same shape for a primitive. Every
 * part is axis-aligned, sized in metres from the subject's bounds and
 * placed relative to the anchor (the centre of the bounds, world origin);
 * +Y is up and a cylinder's or capsule's axis is +Y, a torus faces +Z.
 * The parts of a primitive never leave its bounds.
 */
import type { Vector3 } from '../camera/types.ts';
import type { BoundsM, Primitive } from '../contracts/shot-spec.ts';

/** The surface a part is made of: the subject's body, or its cap (lid, rim, closure) in the look's highlight colour. */
export type PartMaterial = 'body' | 'cap';

/** A box of the given size. */
export interface BoxPart {
  readonly shape: 'box';
  readonly size: Vector3;
}

/** A cylinder of the given radius and height, axis +Y. */
export interface CylinderPart {
  readonly shape: 'cylinder';
  readonly radiusM: number;
  readonly heightM: number;
}

/** A sphere. */
export interface SpherePart {
  readonly shape: 'sphere';
  readonly radiusM: number;
}

/** A capsule: a cylinder of `lengthM` between two hemispheres, axis +Y, total height lengthM + 2 radiusM. */
export interface CapsulePart {
  readonly shape: 'capsule';
  readonly radiusM: number;
  readonly lengthM: number;
}

/** A torus facing +Z: ring radius to the tube's centre and the tube's radius. */
export interface TorusPart {
  readonly shape: 'torus';
  readonly radiusM: number;
  readonly tubeM: number;
}

/** One part of a stand-in. */
export type SubjectPart = (BoxPart | CylinderPart | SpherePart | CapsulePart | TorusPart) & {
  readonly name: string;
  /** The part's centre relative to the subject's anchor, in metres. */
  readonly offset: Vector3;
  readonly material: PartMaterial;
};

/** Fraction of the subject's width a bottle's neck is wide. */
export const bottleNeckWidthFraction = 0.35;

/** Fraction of the subject's height a bottle's body is tall; the neck and cap take the rest. */
export const bottleBodyHeightFraction = 0.72;

/** Fraction of the subject's height a bottle's cap is tall. */
export const bottleCapHeightFraction = 0.06;

/** Fraction of the subject's height a jar's lid is tall. */
export const jarLidHeightFraction = 0.15;

/** Fraction of a can's height each rim band is tall. */
export const canRimHeightFraction = 0.04;

/** The tube of a torus as a fraction of its outer radius. */
export const torusTubeFraction = 0.25;

function at(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

/** The parts of a stand-in for a primitive inside the given bounds; `none` has no parts. */
export function subjectParts(primitive: Primitive, bounds: BoundsM): readonly SubjectPart[] {
  const { w, h, d } = bounds;
  const radius = Math.min(w, d) / 2;
  switch (primitive) {
    case 'none':
      return [];
    case 'bottle': {
      const bodyHeight = h * bottleBodyHeightFraction;
      const capHeight = h * bottleCapHeightFraction;
      const neckHeight = h - bodyHeight - capHeight;
      const bodyCentre = -h / 2 + bodyHeight / 2;
      const neckCentre = -h / 2 + bodyHeight + neckHeight / 2;
      const capCentre = h / 2 - capHeight / 2;
      return [
        { name: 'body', shape: 'cylinder', radiusM: radius, heightM: bodyHeight, offset: at(0, bodyCentre, 0), material: 'body' },
        { name: 'neck', shape: 'cylinder', radiusM: radius * bottleNeckWidthFraction, heightM: neckHeight, offset: at(0, neckCentre, 0), material: 'body' },
        { name: 'cap', shape: 'cylinder', radiusM: radius * bottleNeckWidthFraction * 1.15, heightM: capHeight, offset: at(0, capCentre, 0), material: 'cap' },
      ];
    }
    case 'can': {
      const rim = h * canRimHeightFraction;
      return [
        { name: 'body', shape: 'cylinder', radiusM: radius * 0.97, heightM: h, offset: at(0, 0, 0), material: 'body' },
        { name: 'top-rim', shape: 'cylinder', radiusM: radius, heightM: rim, offset: at(0, h / 2 - rim / 2, 0), material: 'cap' },
        { name: 'bottom-rim', shape: 'cylinder', radiusM: radius, heightM: rim, offset: at(0, -h / 2 + rim / 2, 0), material: 'cap' },
      ];
    }
    case 'box':
    case 'slab':
    case 'card':
      return [{ name: 'body', shape: 'box', size: at(w, h, d), offset: at(0, 0, 0), material: 'body' }];
    case 'pill': {
      // A capsule's hemispheres need their radius in height too, so a flat pill is as round as its height allows.
      const pillRadius = Math.min(radius, h / 2);
      return [{ name: 'body', shape: 'capsule', radiusM: pillRadius, lengthM: h - 2 * pillRadius, offset: at(0, 0, 0), material: 'body' }];
    }
    case 'jar': {
      const lid = h * jarLidHeightFraction;
      const body = h - lid;
      return [
        { name: 'body', shape: 'cylinder', radiusM: radius, heightM: body, offset: at(0, -h / 2 + body / 2, 0), material: 'body' },
        { name: 'lid', shape: 'cylinder', radiusM: radius * 0.95, heightM: lid, offset: at(0, h / 2 - lid / 2, 0), material: 'cap' },
      ];
    }
    case 'sphere':
      return [{ name: 'body', shape: 'sphere', radiusM: Math.min(w, h, d) / 2, offset: at(0, 0, 0), material: 'body' }];
    case 'cylinder':
      return [{ name: 'body', shape: 'cylinder', radiusM: radius, heightM: h, offset: at(0, 0, 0), material: 'body' }];
    case 'torus': {
      const outer = Math.min(w, h) / 2;
      const tube = Math.min(outer * torusTubeFraction, d / 2);
      return [{ name: 'body', shape: 'torus', radiusM: outer - tube, tubeM: tube, offset: at(0, 0, 0), material: 'body' }];
    }
    default:
      return [];
  }
}

/** The axis-aligned extent of a part around its own centre: half sizes in metres. */
export function partHalfExtent(part: SubjectPart): Vector3 {
  switch (part.shape) {
    case 'box':
      return at(part.size.x / 2, part.size.y / 2, part.size.z / 2);
    case 'cylinder':
      return at(part.radiusM, part.heightM / 2, part.radiusM);
    case 'sphere':
      return at(part.radiusM, part.radiusM, part.radiusM);
    case 'capsule':
      return at(part.radiusM, part.lengthM / 2 + part.radiusM, part.radiusM);
    case 'torus':
      return at(part.radiusM + part.tubeM, part.radiusM + part.tubeM, part.tubeM);
    default:
      return at(0, 0, 0);
  }
}
