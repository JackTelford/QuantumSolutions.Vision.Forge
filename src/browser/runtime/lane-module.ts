/**
 * What every browser lane gives the runtime (ADR 0006 decision 1): build
 * the page once from the spec, then render any frame on demand. render(k)
 * must be synchronous and a pure function of k, so a seek followed by a
 * screenshot captures exactly frame k.
 */
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';

/** A lane that renders into the root element. */
export interface LaneModule {
  /** Builds the DOM for the shot once; may throw with a sentence the harness prints. */
  init(spec: ShotPageSpec, root: HTMLElement): void;
  /** Sets every style for the frame from scratch, synchronously. */
  render(frame: number): void;
}
