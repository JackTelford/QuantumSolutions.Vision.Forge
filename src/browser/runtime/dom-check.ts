/**
 * The page-mode check the runtime runs after init and after every seek
 * (ADR 0006 decision 1): nothing in the document may animate or load on
 * its own clock. The lint keeps such code out of src/browser/; this check
 * catches what reaches the DOM anyway.
 */
import { forbiddenElementNames } from '../../shared/harness/protocol.ts';

/** What the check found: the first problem as a sentence (or null) and the number of running animations. */
export interface DomCheckResult {
  readonly problem: string | null;
  readonly animations: number;
}

/** Looks for a forbidden element, a shadow root and running animations; the first problem found is reported, animations are counted either way. */
export function checkDom(root: Document): DomCheckResult {
  const animations = root.getAnimations().length;
  for (const element of root.querySelectorAll('*')) {
    const name = element.tagName.toLowerCase();
    if (forbiddenElementNames.includes(name)) return { problem: `The page contains a <${name}> element, which runs on its own clock.`, animations };
    if (element.shadowRoot !== null) return { problem: `The page contains a <${name}> element with a shadow root.`, animations };
  }
  if (animations > 0) return { problem: `The page has ${String(animations)} running animation(s); a frame must be a pure function of the frame number.`, animations };
  return { problem: null, animations };
}
