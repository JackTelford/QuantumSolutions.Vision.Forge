/**
 * page-mode: what browser lane code under src/browser/ may not contain. A
 * frame is a pure function of the frame number (ADR 0006), so clocks,
 * timers, deferred callbacks, animation loops, unseeded randomness, shadow
 * roots and markup or CSS that animates on its own are rejected before they
 * reach a page.
 */
import ts from 'typescript';
import { findingAtNode, walk } from './finding.ts';
import type { Finding } from './finding.ts';
import { tailName } from './syntax-helpers.ts';

const browserDir = 'src/browser/';
const forbiddenIdentifiers: ReadonlySet<string> = new Set([
  'requestAnimationFrame',
  'requestIdleCallback',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'setAnimationLoop',
  'attachShadow',
]);
const forbiddenMembers: readonly { readonly object: string; readonly member: string }[] = [
  { object: 'Date', member: 'now' },
  { object: 'performance', member: 'now' },
  { object: 'Math', member: 'random' },
  { object: 'crypto', member: 'randomUUID' },
  { object: 'crypto', member: 'getRandomValues' },
];
const forbiddenSubstrings: readonly string[] = ['transition:', 'animation:', 'animation-name:', 'animation-timeline:', '@keyframes', '<iframe', '<video', '<animate'];
const because = 'render(frame) must be a pure function of the frame number (ADR 0006).';

/** page-mode: no timers, deferred callbacks, animation loops, clocks, unseeded randomness, shadow roots, CSS animations or transitions, scroll-driven animations, iframes, video or SMIL in src/browser/. */
export function pageMode(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  if (!path.startsWith(browserDir)) return [];
  const findings: Finding[] = [];
  const report = (node: ts.Node, message: string): void => { findings.push(findingAtNode(sourceFile, path, node, 'page-mode', message)); };
  walk(sourceFile, (node) => {
    if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text)) {
      report(node, `"${node.text}" is not allowed in page mode; ${because}`);
    } else if (ts.isPropertyAccessExpression(node)) {
      const member = forbiddenMembers.find((candidate) => candidate.member === node.name.text && tailName(node.expression) === candidate.object);
      if (member !== undefined) report(node, `"${member.object}.${member.member}" is not allowed in page mode; ${because}`);
    } else if (ts.isNewExpression(node) && tailName(node.expression) === 'Date' && (node.arguments === undefined || node.arguments.length === 0)) {
      report(node, `"new Date()" reads the wall clock; ${because}`);
    } else if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      const hit = forbiddenSubstrings.find((substring) => node.text.includes(substring));
      if (hit !== undefined) report(node, `"${hit}" in a string: CSS animations and transitions, scroll-driven animations, iframes, video and SMIL are not allowed in page mode.`);
    }
  });
  return findings;
}
