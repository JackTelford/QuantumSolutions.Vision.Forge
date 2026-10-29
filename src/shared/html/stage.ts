/**
 * The 2.5D stage of the html lane as styles: the viewport with the
 * perspective and the lit backdrop gradient, the stage element carrying
 * the camera matrix, and the plates that hang in it (backdrop, haze, floor
 * shadow). Layer positions are stage pixels (camera/css-transform.ts): +x
 * right, +y down, +z toward the viewer, `pxPerMetre` per world metre, with
 * the subject's anchor at the origin.
 */
import { layerTransform, stagePxPerMetre, stageTransform, stageTransformValue, worldPointToStage } from '../camera/css-transform.ts';
import type { CameraFrame } from '../camera/types.ts';
import type { ShotPageSpec } from '../harness/protocol.ts';
import type { LightingRig } from '../lighting/rigs.ts';
import { lightingGradient, lightingGradientWithin, rgbaCss } from '../look/css-tokens.ts';
import type { Palette } from '../look/css-tokens.ts';
import { centredBox, num, px } from './styles.ts';
import type { StyleMap } from './styles.ts';

/** The world depth of the backdrop plate behind the subject, in metres. */
export const backdropDepthM = -0.6;

/** The world depth of the haze plate, between the backdrop and the subject. */
export const hazeDepthM = -0.3;

/** How many frame widths and heights the plates span, so a move never shows their edge. */
export const plateFrameMultiple = 4;

/** The haze plate's opacity at haze 1. */
export const hazeOpacityAtFull = 0.6;

/** The floor shadow's width as a multiple of the subject's width. */
export const shadowWidthMultiple = 2.2;

/** The floor shadow's height as a multiple of the subject's depth. */
export const shadowHeightMultiple = 0.6;

/** The floor shadow's opacity at its centre. */
export const shadowOpacity = 0.35;

/** The fraction of the shadow's radius at which it has faded out. */
export const shadowFadePercent = 70;

/** How far below the subject's base the shadow's centre sits, in metres. */
export const shadowDropM = 0.01;

/** The frame height the pixel constants are written for. */
export const referenceHeightPx = 1080;

/** The numbers every layer of a shot shares, computed once at init. */
export interface StageGeometry {
  /** Stage pixels per world metre (fixed from the base pose). */
  readonly pxPerMetre: number;
  /** The frame's width in metres on the subject plane at the base pose. */
  readonly frameWidthM: number;
  /** The frame's height in metres on the subject plane at the base pose. */
  readonly frameHeightM: number;
  /** The frame height over 1080, for pixel constants written at 1080p. */
  readonly scale: number;
}

/** The stage geometry of a spec: the pixel scale from the base pose, the frame in metres at the subject's depth and the 1080p scale factor. */
export function stageGeometry(spec: ShotPageSpec): StageGeometry {
  const pxPerMetre = stagePxPerMetre(spec, spec.shot.lens.focalMm, spec.baseDistanceM);
  return {
    pxPerMetre,
    frameWidthM: spec.width / pxPerMetre,
    frameHeightM: spec.height / pxPerMetre,
    scale: spec.height / referenceHeightPx,
  };
}

/**
 * How much larger the frame measures on a plane at a world depth than on
 * the subject plane: (baseDistance − depth) / baseDistance, since a plane
 * farther from the camera shows more of the world.
 */
export function plateGrowth(spec: ShotPageSpec, depthM: number): number {
  return (spec.baseDistanceM - depthM) / spec.baseDistanceM;
}

/** The size of a plate at a world depth that spans plateFrameMultiple frames as measured at that depth. */
export function plateSizePx(spec: ShotPageSpec, depthM: number): { readonly widthPx: number; readonly heightPx: number } {
  const growth = plateGrowth(spec, depthM);
  return { widthPx: plateFrameMultiple * spec.width * growth, heightPx: plateFrameMultiple * spec.height * growth };
}

/** The viewport: fills the root, clips, carries the frame's perspective and the lit backdrop gradient (its angle follows the key-light orbit). */
export function viewportStyle(spec: ShotPageSpec, frame: CameraFrame, geometry: StageGeometry, rig: LightingRig, palette: Palette): StyleMap {
  const transform = stageTransform(frame, spec, geometry.pxPerMetre);
  return {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    perspective: px(transform.perspectivePx),
    'perspective-origin': '50% 50%',
    background: lightingGradient(rig, palette, frame.keyLightOrbitDeg),
  };
}

/**
 * The stage: a zero-size element at the viewport centre whose transform is
 * the camera matrix, preceded by the parallax-drift offset in pixels
 * (stageOffset is a fraction of the frame) so the whole stage slides.
 */
export function stageStyle(spec: ShotPageSpec, frame: CameraFrame, geometry: StageGeometry): StyleMap {
  const transform = stageTransform(frame, spec, geometry.pxPerMetre);
  const offsetX = frame.stageOffset.x * spec.width;
  const offsetY = frame.stageOffset.y * spec.height;
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '0',
    height: '0',
    'transform-origin': '0 0 0',
    'transform-style': 'preserve-3d',
    transform: `translate(${px(offsetX)}, ${px(offsetY)}) ${stageTransformValue(transform)}`,
  };
}

/**
 * The slice of the backdrop's gradient line the frame sees at the base
 * pose: the plate is plateFrameMultiple frames wide and shares the frame's
 * centre and proportions, so the frame covers the central 1/plateFrameMultiple
 * of the line whatever the gradient's angle (37.5 to 62.5 percent for 4).
 */
export const backdropGradientWindow = {
  startPercent: 50 - 50 / plateFrameMultiple,
  spanPercent: 100 / plateFrameMultiple,
} as const;

/**
 * The backdrop plate: behind the subject, four frames wide so a move never
 * shows the void. The lit fade is confined to the slice of the plate the
 * frame sees at the base pose, the surface colour before it and the
 * background after: stretched across the whole plate, the frame would only
 * ever see the flat middle of the gradient line and the lit side would
 * never enter it, while a one-frame gradient over a plain fill would end
 * in a hard edge that a drift or a truck could slide into the frame.
 */
export function backdropStyle(spec: ShotPageSpec, geometry: StageGeometry, frame: CameraFrame, rig: LightingRig, palette: Palette): StyleMap {
  const size = plateSizePx(spec, backdropDepthM);
  return {
    ...centredBox(size.widthPx, size.heightPx),
    transform: layerTransform(worldPointToStage({ x: 0, y: 0, z: backdropDepthM }, geometry.pxPerMetre)),
    background: lightingGradientWithin(rig, palette, frame.keyLightOrbitDeg, backdropGradientWindow.startPercent, backdropGradientWindow.spanPercent),
  };
}

/** The haze plate: between the backdrop and the subject, the background colour at an opacity that follows the shot's haze. */
export function hazeStyle(spec: ShotPageSpec, geometry: StageGeometry, palette: Palette): StyleMap {
  const size = plateSizePx(spec, hazeDepthM);
  return {
    ...centredBox(size.widthPx, size.heightPx),
    transform: layerTransform(worldPointToStage({ x: 0, y: 0, z: hazeDepthM }, geometry.pxPerMetre)),
    background: rgbaCss(palette.background, hazeOpacityAtFull * spec.shot.atmosphere.haze),
  };
}

/**
 * The floor shadow: a soft ellipse of the background colour just below the
 * subject's base, wider than the subject and as tall as a fraction of its
 * depth. It faces the camera rather than lying flat on the floor: a plate
 * rotated into the floor is seen edge-on at eye level, the default angle,
 * and grounds nothing there. It sits on the subject's plane and is drawn
 * before the stand-in, so the stand-in covers its upper half.
 */
export function shadowStyle(spec: ShotPageSpec, geometry: StageGeometry, palette: Palette): StyleMap {
  const bounds = spec.shot.subject.boundsM;
  const u = geometry.pxPerMetre;
  return {
    ...centredBox(bounds.w * shadowWidthMultiple * u, bounds.d * shadowHeightMultiple * u),
    transform: layerTransform(worldPointToStage({ x: 0, y: -bounds.h / 2 - shadowDropM, z: 0 }, u)),
    background: `radial-gradient(ellipse at center, ${rgbaCss(palette.background, shadowOpacity)} 0%, ${rgbaCss(palette.background, 0)} ${num(shadowFadePercent)}%)`,
  };
}
