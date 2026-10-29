/**
 * What every browser lane gives the runtime (ADR 0006 decision 1): build
 * the page once from the spec, then render any frame on demand. render(k)
 * must be synchronous and a pure function of k, so a seek followed by a
 * screenshot captures exactly frame k.
 */
import type { ShotPageSpec, TextOverflow } from '../../shared/harness/protocol.ts';

/** A lane that renders into the root element. */
export interface LaneModule {
  /** Builds the DOM for the shot once; may throw with a sentence the harness prints. A lane that loads something (the three lane's environment map) returns a promise the runtime awaits. */
  init(spec: ShotPageSpec, root: HTMLElement): void | Promise<void>;
  /** Sets every style for the frame from scratch, synchronously. */
  render(frame: number): void;
  /** Lays every text element out in its shown state and measures how far each spills past its box; a lane without text may omit it. */
  measureText?(): readonly TextOverflow[];
  /** The renderer string of the WebGL context that draws the frames; a lane that draws with WebGL offers it and the runtime reports it instead of probing a throwaway context. */
  webglRenderer?(): string | null;
  /** Frees what the lane holds outside the DOM (GPU buffers, a WebGL context); the runtime calls it before the next init on the same page. */
  dispose?(): void;
}
