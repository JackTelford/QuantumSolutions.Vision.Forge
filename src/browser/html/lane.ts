/**
 * The html lane: a title card, lower third or kinetic-type shot as a 2.5D
 * stage (backdrop, haze, floor shadow, subject stand-in, motes) under a
 * flat text overlay. init builds the elements once; render(frame) writes
 * every inline style from scratch from the shared, pure style functions
 * under src/shared/html/, so a frame depends on nothing but its number.
 */
import type { CameraFrame } from '../../shared/camera/types.ts';
import type { TextElement } from '../../shared/contracts/shot-spec.ts';
import type { ShotPageSpec, TextOverflow } from '../../shared/harness/protocol.ts';
import { calibrationScene } from '../../shared/calibration/scene.ts';
import type { CalibrationPatch } from '../../shared/calibration/scene.ts';
import { calibrationBackdropStyle, calibrationPatchStyle, calibrationPatches } from '../../shared/html/calibration.ts';
import { moteField, moteStyle } from '../../shared/html/motes.ts';
import type { Mote } from '../../shared/html/motes.ts';
import { backdropStyle, hazeStyle, shadowStyle, stageGeometry, stageStyle, viewportStyle } from '../../shared/html/stage.ts';
import type { StageGeometry } from '../../shared/html/stage.ts';
import { standInContainerStyle, standInPartNames, standInParts } from '../../shared/html/stand-in.ts';
import { textBoxStyle, textElementVisible, textOverlayStyle, textPlate, textPlateStyle, textSpanContent, textSpanStates, textSpanStyle, textSpans } from '../../shared/html/text.ts';
import { shownState } from '../../shared/typography/text-animation.ts';
import { shotLightingRig } from '../../shared/lighting/rigs.ts';
import type { LightingRig } from '../../shared/lighting/rigs.ts';
import type { LaneModule } from '../runtime/lane-module.ts';
import { appendDiv, appendSpan, setStyle } from './dom.ts';

/** The elements of one text element: its box, the plate inside it and one span per word. */
interface TextElements {
  readonly element: TextElement;
  readonly box: HTMLDivElement;
  readonly plate: HTMLDivElement;
  readonly spans: readonly HTMLSpanElement[];
  readonly words: readonly string[];
}

/** Everything init built, kept for render. */
interface Built {
  readonly spec: ShotPageSpec;
  readonly geometry: StageGeometry;
  readonly rig: LightingRig;
  readonly viewport: HTMLDivElement;
  readonly stage: HTMLDivElement;
  readonly backdrop: HTMLDivElement;
  readonly haze: HTMLDivElement;
  readonly shadow: HTMLDivElement;
  readonly standIn: HTMLDivElement;
  readonly parts: readonly HTMLDivElement[];
  readonly motes: readonly { readonly mote: Mote; readonly element: HTMLDivElement }[];
  readonly texts: readonly TextElements[];
}

/** The calibration scene's elements (ADR 0008 decision 2): a backdrop and one flat div per patch. */
interface CalibrationElements {
  readonly spec: ShotPageSpec;
  readonly backdrop: HTMLDivElement;
  readonly patches: readonly { readonly patch: CalibrationPatch; readonly element: HTMLDivElement }[];
}

/** The html lane. */
export class HtmlLane implements LaneModule {
  private built: Built | undefined = undefined;
  private calibration: CalibrationElements | undefined = undefined;

  /** Builds the stage and the text overlay under the root (or the flat calibration patches when the spec asks for that scene); a second init replaces the first. */
  init(spec: ShotPageSpec, root: HTMLElement): void {
    root.replaceChildren();
    this.built = undefined;
    this.calibration = undefined;
    if (spec.scene === 'calibration') {
      const backdrop = appendDiv(root, 'vf-calibration');
      const patches = calibrationPatches(calibrationScene.elements).map((patch) => ({ patch, element: appendDiv(backdrop, `vf-patch vf-patch-${patch.id}`) }));
      this.calibration = { spec, backdrop, patches };
      return;
    }
    const viewport = appendDiv(root, 'vf-viewport');
    const stage = appendDiv(viewport, 'vf-stage');
    const backdrop = appendDiv(stage, 'vf-backdrop');
    const haze = appendDiv(stage, 'vf-haze');
    const shadow = appendDiv(stage, 'vf-shadow');
    const standIn = appendDiv(stage, 'vf-stand-in');
    const parts = standInPartNames(spec.shot.subject.primitive).map((name) => appendDiv(standIn, `vf-part vf-part-${name}`));
    const geometry = stageGeometry(spec);
    const motes = moteField(spec.shot, geometry).map((mote) => ({ mote, element: appendDiv(stage, 'vf-mote') }));
    const overlay = appendDiv(root, 'vf-text');
    const texts = spec.shot.text.map((element) => buildText(overlay, element));
    this.built = { spec, geometry, rig: shotLightingRig(spec.shot.lighting), viewport, stage, backdrop, haze, shadow, standIn, parts, motes, texts };
    setStyle(overlay, textOverlayStyle());
  }

  /** Writes every style for the frame. Throws when init has not run or the frame has no baked camera. */
  render(frame: number): void {
    const calibration = this.calibration;
    if (calibration !== undefined) {
      // The patches do not move; the styles are still written per frame so a frame depends on nothing before it.
      setStyle(calibration.backdrop, calibrationBackdropStyle(calibration.spec.look.palette));
      for (const { patch, element } of calibration.patches) setStyle(element, calibrationPatchStyle(patch, calibration.spec.width, calibration.spec.height));
      return;
    }
    const built = this.built;
    if (built === undefined) throw new Error('The html lane has not been initialised.');
    const camera = built.spec.camera[frame];
    if (camera === undefined) throw new Error(`Frame ${String(frame)} has no baked camera; the shot has ${String(built.spec.camera.length)} frames.`);
    renderStage(built, camera);
    for (const text of built.texts) renderText(built, text, frame);
  }

  /**
   * Styles every text element as fully shown and measures its plate
   * against its box, so the harness learns about text the estimate in
   * typography/fit.ts could not keep inside the box. The next render
   * restores the frame's styles.
   */
  measureText(): readonly TextOverflow[] {
    if (this.calibration !== undefined) return [];
    const built = this.built;
    if (built === undefined) throw new Error('The html lane has not been initialised.');
    return built.texts.map((text) => {
      const { spec } = built;
      setStyle(text.box, textBoxStyle(text.element, spec, spec.look));
      setStyle(text.plate, textPlateStyle(textPlate(text.element.role), spec.look.palette, spec.height));
      text.spans.forEach((span, index) => {
        const word = text.words[index];
        if (word === undefined) return;
        setStyle(span, textSpanStyle(shownState, text.element, spec.look));
        span.textContent = textSpanContent(text.element, word, shownState);
      });
      const box = text.box.getBoundingClientRect();
      const plate = text.plate.getBoundingClientRect();
      return { id: text.element.id, overflowXPx: Math.max(0, plate.right - box.right), overflowYPx: Math.max(0, plate.bottom - box.bottom) };
    });
  }
}

/** Builds the box, plate and spans of a text element; words are separated by spaces so they wrap as text. */
function buildText(overlay: HTMLElement, element: TextElement): TextElements {
  const box = appendDiv(overlay, `vf-text-box vf-role-${element.role}`);
  const plate = appendDiv(box, 'vf-text-plate');
  const words = textSpans(element);
  const spans = words.map((word, index) => {
    if (index > 0) plate.appendChild(plate.ownerDocument.createTextNode(' '));
    const span = appendSpan(plate, 'vf-word');
    span.textContent = word;
    return span;
  });
  return { element, box, plate, spans, words };
}

/** The stage for one camera frame: viewport, stage matrix, plates, stand-in and motes. */
function renderStage(built: Built, camera: CameraFrame): void {
  const { spec, geometry, rig } = built;
  const palette = spec.look.palette;
  setStyle(built.viewport, viewportStyle(spec, camera, geometry, rig, palette));
  setStyle(built.stage, stageStyle(spec, camera, geometry));
  setStyle(built.backdrop, backdropStyle(spec, geometry, camera, rig, palette));
  setStyle(built.haze, hazeStyle(spec, geometry, palette));
  setStyle(built.shadow, shadowStyle(spec, geometry, palette));
  setStyle(built.standIn, standInContainerStyle(spec.shot, geometry, camera));
  const parts = standInParts(spec.shot, geometry, rig, palette, camera.keyLightOrbitDeg);
  built.parts.forEach((part, index) => {
    const style = parts[index];
    if (style !== undefined) setStyle(part, style.style);
  });
  for (const { mote, element } of built.motes) setStyle(element, moteStyle(mote, camera.frame, spec.fps, geometry, palette));
}

/** One text element at a frame: hidden entirely before and after it, otherwise its box, plate and every span restyled. */
function renderText(built: Built, text: TextElements, frame: number): void {
  const { spec } = built;
  const states = textSpanStates(text.element, frame, spec);
  const boxStyle = textBoxStyle(text.element, spec, spec.look);
  setStyle(text.box, textElementVisible(states) ? boxStyle : { ...boxStyle, display: 'none' });
  setStyle(text.plate, textPlateStyle(textPlate(text.element.role), spec.look.palette, spec.height));
  text.spans.forEach((span, index) => {
    const state = states[index];
    const word = text.words[index];
    if (state === undefined || word === undefined) return;
    setStyle(span, textSpanStyle(state, text.element, spec.look));
    span.textContent = textSpanContent(text.element, word, state);
  });
}
