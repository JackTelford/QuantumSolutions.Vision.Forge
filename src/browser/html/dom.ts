/**
 * The few DOM operations the html lane needs: make an element with a class
 * under a parent, and write a style map as the element's whole inline style.
 */
import { styleText } from '../../shared/html/styles.ts';
import type { StyleMap } from '../../shared/html/styles.ts';

/** Appends a div with the class name to the parent and returns it. */
export function appendDiv(parent: HTMLElement, className: string): HTMLDivElement {
  const element = parent.ownerDocument.createElement('div');
  element.className = className;
  parent.appendChild(element);
  return element;
}

/** Appends a span with the class name to the parent and returns it. */
export function appendSpan(parent: HTMLElement, className: string): HTMLSpanElement {
  const element = parent.ownerDocument.createElement('span');
  element.className = className;
  parent.appendChild(element);
  return element;
}

/** Replaces the element's inline style with the map, so nothing from an earlier frame survives. */
export function setStyle(element: HTMLElement, style: StyleMap): void {
  element.style.cssText = styleText(style);
}
