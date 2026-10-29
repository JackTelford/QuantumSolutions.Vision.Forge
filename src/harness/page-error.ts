/**
 * The errors the browser harness raises when the browser or the page does
 * not do what the capture protocol expects (ADR 0006). Each one carries the
 * page's own sentence where there is one, plus the last console lines, so
 * the CLI can print why a frame could not be rendered without a stack trace.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';
import type { RendererPolicy } from './types.ts';

/** The page's last console errors appended to a message, or nothing when there were none. */
export function withConsoleTail(message: string, consoleTail: readonly string[]): string {
  return consoleTail.length === 0 ? message : `${message} Console: ${consoleTail.join(' | ')}`;
}

/** The message and hint of a renderer mismatch, per policy: under 'any' the browser has no WebGL at all, which no policy fixes. */
function mismatchText(policy: RendererPolicy, renderer: string): { readonly message: string; readonly hint: string } {
  if (policy === 'any') {
    return {
      message: `The browser has no usable WebGL context under either renderer (${renderer}).`,
      hint: 'Run "doctor" to see the browser\'s WebGL report, update the GPU driver, or try the other browser channel.',
    };
  }
  const other = policy === 'hardware' ? 'software' : 'hardware';
  return {
    message: `The renderer policy is "${policy}" but the browser reports "${renderer}".`,
    hint: `Pass --renderer any to accept what the browser offers, or --renderer ${other}.`,
  };
}

/** The browser's WebGL renderer does not match the renderer policy (ADR 0006 decision 4). Exit 1. */
export class RendererMismatchError extends VisionForgeError {
  readonly policy: RendererPolicy;
  readonly renderer: string;

  constructor(policy: RendererPolicy, renderer: string) {
    super({ code: 'renderer-mismatch', ...mismatchText(policy, renderer) });
    this.policy = policy;
    this.renderer = renderer;
  }
}

/** The page did not load, did not install the protocol, or its init report says it cannot render. Exit 1. */
export class PageInitError extends VisionForgeError {
  readonly pageUrl: string;
  readonly consoleTail: readonly string[];

  constructor(pageUrl: string, message: string, consoleTail: readonly string[]) {
    super({
      code: 'page-init',
      message: withConsoleTail(message, consoleTail),
      // The URL is the harness's ephemeral port; it is dead once the command exits, so the hint points at the log instead.
      hint: 'The last console errors are in the message; run again with --verbose to see every console error as the page logs it.',
    });
    this.pageUrl = pageUrl;
    this.consoleTail = [...consoleTail];
  }
}

/** A seek or its screenshot failed for one frame. Exit 1. */
export class PageSeekError extends VisionForgeError {
  readonly pageUrl: string;
  readonly frame: number;
  readonly consoleTail: readonly string[];

  constructor(pageUrl: string, frame: number, message: string, consoleTail: readonly string[]) {
    super({
      code: 'page-seek',
      message: withConsoleTail(`Frame ${frame}: ${message}`, consoleTail),
      hint: `Run again with --verbose to see every console error as the page logs it, and check the shot's text and camera for frame ${frame}.`,
    });
    this.pageUrl = pageUrl;
    this.frame = frame;
    this.consoleTail = [...consoleTail];
  }
}
