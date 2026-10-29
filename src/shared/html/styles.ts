/**
 * Inline styles as data. The html lane computes every style as a map of
 * CSS property names to values (pure functions of the frame, testable in
 * Node) and writes each map as one `style.cssText`, so a render replaces
 * every property from scratch and nothing lingers from the frame before.
 */

/** CSS property names (kebab case) to values. */
export type StyleMap = Readonly<Record<string, string>>;

/** A length in CSS pixels with three decimals, so the same number always gives the same text. */
export function px(value: number): string {
  return `${value.toFixed(3)}px`;
}

/** A unitless number with three decimals. */
export function num(value: number): string {
  return value.toFixed(3);
}

/** The `cssText` of a style map: `name: value` pairs joined by semicolons, in map order. */
export function styleText(style: StyleMap): string {
  return Object.entries(style).map(([name, value]) => `${name}: ${value}`).join('; ');
}

/** An absolutely positioned box of the given size whose centre sits at its parent's origin, so a translate puts the centre at a stage point. */
export function centredBox(widthPx: number, heightPx: number): StyleMap {
  return {
    position: 'absolute',
    left: px(-widthPx / 2),
    top: px(-heightPx / 2),
    width: px(widthPx),
    height: px(heightPx),
  };
}
