/**
 * The calibration scene in the html lane (ADR 0008 decision 2): the
 * patches of calibration/scene.ts as flat divs of their own sRGB colour at
 * their frame boxes over the look's background. No stage, no stand-in, no
 * lights: the html lane is display-referred, so a patch shows exactly its
 * hex and the YAVG it measures is the scene's expectation by construction.
 * The three lane's render of the same boxes is what gets calibrated to it.
 */
import type { CalibrationElement, CalibrationPatch } from '../calibration/scene.ts';
import type { Palette } from '../look/css-tokens.ts';
import { px } from './styles.ts';
import type { StyleMap } from './styles.ts';

/** The patches of the scene, in order; spheres and the text line are not drawn flat. */
export function calibrationPatches(elements: readonly CalibrationElement[]): readonly CalibrationPatch[] {
  return elements.filter((element): element is CalibrationPatch => element.kind === 'patch');
}

/** The backdrop that fills the frame with the look's background. */
export function calibrationBackdropStyle(palette: Palette): StyleMap {
  return { position: 'absolute', inset: '0', background: palette.background };
}

/** A patch as a flat box at its frame fractions scaled to the frame's pixels, filled with its colour. */
export function calibrationPatchStyle(patch: CalibrationPatch, widthPx: number, heightPx: number): StyleMap {
  return {
    position: 'absolute',
    left: px(patch.box.x * widthPx),
    top: px(patch.box.y * heightPx),
    width: px(patch.box.w * widthPx),
    height: px(patch.box.h * heightPx),
    background: patch.hex,
  };
}
