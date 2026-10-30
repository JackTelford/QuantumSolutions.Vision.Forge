/**
 * One piece of work at a time (ADR 0009 decision 6): the tools that render
 * or encode share the browser profile and Blender, so their runs queue here
 * whether they run inline or as tasks. The server may serialize exclusive
 * requests on its own as well; a background task escapes that, which is why
 * the lane sits with the tools.
 */

/** A queue that runs the work handed to it one at a time, in order. */
export class WorkLane {
  private tail: Promise<void> = Promise.resolve();
  private depth = 0;

  /** True while a piece of work runs or waits. */
  isBusy(): boolean {
    return this.depth > 0;
  }

  /** Runs the work once everything queued before it has finished; its result or error passes through. */
  run<T>(work: () => Promise<T>): Promise<T> {
    this.depth += 1;
    const turn = this.tail.then(work);
    this.tail = turn.then(() => undefined, () => undefined).finally(() => { this.depth -= 1; });
    return turn;
  }
}
