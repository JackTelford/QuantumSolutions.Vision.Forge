/**
 * The subject stand-in of the html lane: a flat plate at the anchor, sized
 * from the subject's bounds in metres, shaped by its primitive, filled with
 * the primary colour under a specular sheen and shadowed away from the key.
 * Each primitive is one or two absolutely positioned parts inside a
 * container that carries the stage translate and the turntable rotation.
 */
import { layerTransform, worldPointToStage } from '../camera/css-transform.ts';
import type { CameraFrame } from '../camera/types.ts';
import type { Primitive, Shot } from '../contracts/shot-spec.ts';
import type { LightingRig } from '../lighting/rigs.ts';
import { rgbaCss, shadowOffset, sheenGradient } from '../look/css-tokens.ts';
import type { Palette } from '../look/css-tokens.ts';
import type { StageGeometry } from './stage.ts';
import { centredBox, num, px } from './styles.ts';
import type { StyleMap } from './styles.ts';

/** One shape of a stand-in with its style; the lane keeps one element per part. */
export interface StandInPart {
  readonly name: string;
  readonly style: StyleMap;
}

/** The box-shadow's offset as a fraction of the subject's height in pixels. */
export const shadowOffsetFraction = 0.06;

/** The box-shadow's blur as a fraction of the subject's height in pixels. */
export const shadowBlurFraction = 0.08;

/** The opacity of the stand-in's box-shadow. */
export const standInShadowOpacity = 0.45;

/** The names of the parts a primitive is drawn with, in paint order; `none` has no stand-in. */
export function standInPartNames(primitive: Primitive): readonly string[] {
  switch (primitive) {
    case 'none':
      return [];
    case 'bottle':
      // The neck first, so the body paints over its base and the neck's shadow does not fall on the body.
      return ['neck', 'body'];
    case 'jar':
      return ['body', 'lid'];
    default:
      return ['body'];
  }
}

/** The container: the subject's bounds in stage pixels, centred on the anchor, turned about its vertical axis by the frame's turntable angle. */
export function standInContainerStyle(shot: Shot, geometry: StageGeometry, frame: CameraFrame): StyleMap {
  const u = geometry.pxPerMetre;
  const bounds = shot.subject.boundsM;
  const translate = layerTransform(worldPointToStage({ x: 0, y: 0, z: 0 }, u));
  const rotate = frame.subjectRotationDeg === 0 ? '' : ` rotateY(${num(frame.subjectRotationDeg)}deg)`;
  return {
    ...centredBox(bounds.w * u, bounds.h * u),
    'transform-style': 'preserve-3d',
    transform: `${translate}${rotate}`,
  };
}

/** The fill every part shares: the sheen over the primary colour, and a soft shadow away from the key. */
function surfaceStyle(heightPx: number, rig: LightingRig, palette: Palette, keyOrbitDeg: number): StyleMap {
  const offset = shadowOffset(rig, heightPx * shadowOffsetFraction, keyOrbitDeg);
  return {
    background: `${sheenGradient(rig, palette, keyOrbitDeg)}, ${palette.primary}`,
    'box-shadow': `${px(offset.x)} ${px(offset.y)} ${px(heightPx * shadowBlurFraction)} ${rgbaCss('#000000', standInShadowOpacity)}`,
  };
}

/** A part filling a fraction of the container: left and top as fractions of its width and height, width and height likewise. */
function partBox(left: number, top: number, width: number, height: number): StyleMap {
  return {
    position: 'absolute',
    left: `${num(left * 100)}%`,
    top: `${num(top * 100)}%`,
    width: `${num(width * 100)}%`,
    height: `${num(height * 100)}%`,
  };
}

/**
 * The parts of a primitive at a container size. A bottle is a body with a
 * narrower neck above it; a can or a cylinder is a rounded rectangle; a
 * box or a slab is square-cornered and a card lightly rounded; a pill is
 * fully rounded; a jar carries a lid band; a sphere is a circle and a
 * torus a circle with a hole cut by a radial gradient.
 */
export function standInParts(shot: Shot, geometry: StageGeometry, rig: LightingRig, palette: Palette, keyOrbitDeg: number): readonly StandInPart[] {
  const u = geometry.pxPerMetre;
  const widthPx = shot.subject.boundsM.w * u;
  const heightPx = shot.subject.boundsM.h * u;
  const surface = surfaceStyle(heightPx, rig, palette, keyOrbitDeg);
  const fullRadius = px(Math.min(widthPx, heightPx) / 2);
  switch (shot.subject.primitive) {
    case 'none':
      return [];
    case 'bottle':
      return [
        { name: 'neck', style: { ...partBox(0.32, 0, 0.36, 0.26), ...surface, 'border-radius': `${px(widthPx * 0.08)} ${px(widthPx * 0.08)} 0 0` } },
        { name: 'body', style: { ...partBox(0, 0.22, 1, 0.78), ...surface, 'border-radius': `${px(widthPx * 0.12)} / ${px(heightPx * 0.06)}` } },
      ];
    case 'can':
    case 'cylinder':
      return [{ name: 'body', style: { ...partBox(0, 0, 1, 1), ...surface, 'border-radius': `${px(widthPx * 0.12)} / ${px(heightPx * 0.12)}` } }];
    case 'box':
    case 'slab':
      return [{ name: 'body', style: { ...partBox(0, 0, 1, 1), ...surface } }];
    case 'card':
      return [{ name: 'body', style: { ...partBox(0, 0, 1, 1), ...surface, 'border-radius': px(Math.min(widthPx, heightPx) * 0.04) } }];
    case 'pill':
      return [{ name: 'body', style: { ...partBox(0, 0, 1, 1), ...surface, 'border-radius': fullRadius } }];
    case 'jar':
      return [
        { name: 'body', style: { ...partBox(0, 0, 1, 1), ...surface, 'border-radius': `${px(widthPx * 0.08)} / ${px(heightPx * 0.08)}` } },
        { name: 'lid', style: { ...partBox(0, 0, 1, 0.14), background: palette.surface, 'border-radius': `${px(widthPx * 0.08)} ${px(widthPx * 0.08)} 0 0` } },
      ];
    case 'sphere':
      return [{ name: 'body', style: { ...partBox(0, 0, 1, 1), ...surface, 'border-radius': '50%' } }];
    case 'torus':
      return [{
        name: 'body',
        style: {
          ...partBox(0, 0, 1, 1),
          ...surface,
          'border-radius': '50%',
          // The hole: a mask that is clear to 28 percent of the radius cuts through the sheen and the fill. The mask also
          // clips everything outside the border box, so a torus casts no box-shadow; the hole stays see-through in exchange.
          'mask-image': 'radial-gradient(circle at 50% 50%, transparent 0 28%, #000 30%)',
        },
      }];
  }
}
