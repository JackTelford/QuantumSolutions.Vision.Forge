/**
 * The text overlay of the html lane as styles: one box per text element
 * placed from its frame-fraction box, set in the look's type system
 * (typography/scale.ts), on a plate for lower thirds and a scrim for
 * captions, with one span per word for stagger-words and one span
 * otherwise, each styled per frame from typography/text-animation.ts.
 */
import type { Shot, TextElement, TextRole } from '../contracts/shot-spec.ts';
import type { LookBible } from '../contracts/look-bible.ts';
import type { ShotPageSpec } from '../harness/protocol.ts';
import { rgbaCss } from '../look/css-tokens.ts';
import type { Palette } from '../look/css-tokens.ts';
import { textFloorPx } from '../composition/checks.ts';
import { fitTextSize } from '../typography/fit.ts';
import { bundledFonts, roleFamily, roleLineHeights, roleTrackingEm, roleUppercase, roleWeight, tabularRoles } from '../typography/scale.ts';
import { counterText, splitWords, textState } from '../typography/text-animation.ts';
import type { TextStyleState } from '../typography/text-animation.ts';
import { num, px } from './styles.ts';
import type { StyleMap } from './styles.ts';

/** What sits behind a text element: a surface plate for lower thirds, a translucent scrim for captions, nothing otherwise. */
export type TextPlate = 'lower-third' | 'caption' | 'none';

/** The padding of a plate or scrim at 1080p, in pixels; scales with the frame height. */
export const platePaddingPx = 24;

/** The width of the accent bar on a lower-third plate at 1080p, in pixels. */
export const plateBarPx = 6;

/** The scrim's opacity under a caption. */
export const captionScrimOpacity = 0.6;

/** The roles that sit on a lower-third plate. */
export const lowerThirdRoles: ReadonlySet<TextRole> = new Set<TextRole>(['lower-third-name', 'lower-third-title']);

/** The plate a role sits on. */
export function textPlate(role: TextRole): TextPlate {
  if (lowerThirdRoles.has(role)) return 'lower-third';
  if (role === 'caption') return 'caption';
  return 'none';
}

/** The spans of an element: one per word for stagger-words, one for the whole content otherwise; an empty content has none. */
export function textSpans(element: TextElement): readonly string[] {
  if (element.animation === 'stagger-words') return splitWords(element.content);
  return element.content.length === 0 ? [] : [element.content];
}

/** The `text-align` of the shot's text side: left and right as named, centre otherwise. */
export function textAlign(shot: Shot): 'left' | 'right' | 'center' {
  const side = shot.composition.textSide;
  return side === 'left' || side === 'right' ? side : 'center';
}

/** The `justify-content` that matches a text alignment inside a flex row. */
function justifyFor(align: 'left' | 'right' | 'center'): string {
  return align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
}

/** The overlay that holds every text box: fills the root, in front of the stage, no perspective. */
export function textOverlayStyle(): StyleMap {
  return { position: 'absolute', inset: '0', overflow: 'hidden' };
}

/**
 * A text element's box: its frame-fraction box in pixels, a flex row that
 * bottom-aligns lower thirds and centres everything else, and the role's
 * type: family, size, weight, tracking, line height, case, tabular figures
 * for counters and labels, the look's text colour, balanced wrapping.
 */
export function textBoxStyle(element: TextElement, spec: ShotPageSpec, look: LookBible): StyleMap {
  const role = element.role;
  const family = roleFamily(role, look.typography);
  const fontSizePx = fittedFontSizePx(element, spec, look);
  const style: Record<string, string> = {
    position: 'absolute',
    left: px(element.box.x * spec.width),
    top: px(element.box.y * spec.height),
    width: px(element.box.w * spec.width),
    height: px(element.box.h * spec.height),
    overflow: 'visible',
    display: 'flex',
    'align-items': textPlate(role) === 'lower-third' ? 'flex-end' : 'center',
    'justify-content': justifyFor(textAlign(spec.shot)),
    'text-align': textAlign(spec.shot),
    'font-family': `'${bundledFonts[family].cssFamily}'`,
    'font-size': px(fontSizePx),
    'font-weight': String(roleWeight(role, family)),
    'line-height': num(roleLineHeights[role]),
    color: look.palette.text,
    'text-wrap': 'balance',
  };
  if (roleUppercase(role)) style['text-transform'] = 'uppercase';
  if (tabularRoles.has(role)) style['font-variant-numeric'] = 'tabular-nums';
  return style;
}

/**
 * The font size of an element: the role's scale size shrunk to fit the
 * box's inner size (the box less the plate's padding on both sides), never
 * below the composition floor (typography/fit.ts), so the planner's check
 * and the lane agree.
 */
export function fittedFontSizePx(element: TextElement, spec: ShotPageSpec, look: LookBible): number {
  const padding = textPlate(element.role) === 'none' ? 0 : 2 * platePaddingPx * (spec.height / 1080);
  const widthPx = Math.max(1, element.box.w * spec.width - padding);
  const heightPx = Math.max(1, element.box.h * spec.height - padding);
  return fitTextSize(element.content, element.role, widthPx, heightPx, look.typography, spec.height, textFloorPx(element.role, spec.height)).fontSizePx;
}

/** The plate behind the words: the surface colour with an accent bar for a lower third, a translucent background scrim for a caption, nothing else otherwise. */
export function textPlateStyle(plate: TextPlate, palette: Palette, heightPx: number): StyleMap {
  const scale = heightPx / 1080;
  const base: StyleMap = { 'max-width': '100%', 'box-sizing': 'border-box' };
  switch (plate) {
    case 'lower-third':
      return { ...base, background: palette.surface, padding: px(platePaddingPx * scale), 'border-left': `${px(plateBarPx * scale)} solid ${palette.accent}` };
    case 'caption':
      return { ...base, background: rgbaCss(palette.background, captionScrimOpacity), padding: px(platePaddingPx * scale) };
    case 'none':
      return base;
  }
}

/** The state of every span of an element at a frame: word i of a staggered element is delayed by i steps; a single span is word 0. */
export function textSpanStates(element: TextElement, frame: number, spec: ShotPageSpec): readonly TextStyleState[] {
  return textSpans(element).map((_, index) => textState(element, frame, spec.fps, spec.height, index));
}

/** True when any span is on its way in, held or on its way out; false before the element and after it. */
export function textElementVisible(states: readonly TextStyleState[]): boolean {
  return states.some((state) => state.phase !== 'before' && state.phase !== 'after');
}

/**
 * A span's style at a frame: its opacity, rise, blur (omitted at 0), the
 * role's tracking plus the animation's extra, the mask-wipe clip (omitted
 * when fully revealed) and `display: none` while it is hidden before its
 * entrance or after its exit.
 */
export function textSpanStyle(state: TextStyleState, element: TextElement, look: LookBible): StyleMap {
  const style: Record<string, string> = {
    display: 'inline-block',
    opacity: num(state.opacity),
    transform: `translateY(${px(state.translateYPx)})`,
    'letter-spacing': `${num(roleTrackingEm(element.role, look.typography) + state.trackingEmExtra)}em`,
  };
  if (state.blurPx > 0) style['filter'] = `blur(${px(state.blurPx)})`;
  if (state.revealFraction < 1) style['clip-path'] = `inset(0 ${num((1 - state.revealFraction) * 100)}% 0 0)`;
  if (state.opacity === 0 && (state.phase === 'before' || state.phase === 'after')) style['display'] = 'none';
  return style;
}

/** The text a span shows: the counter's value at its fraction for the counter role or animation, the word itself otherwise. */
export function textSpanContent(element: TextElement, word: string, state: TextStyleState): string {
  if (element.role === 'counter' || element.animation === 'counter') return counterText(word, state.counterFraction);
  return word;
}
