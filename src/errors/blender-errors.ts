/**
 * The errors of the blender lane's success predicate (ADR 0004 decision
 * 7). Each one is a VisionForgeError with a stable code the CLI result
 * carries: `blender-script` when the applier's Python raised (exit 3),
 * `blender-render` when Blender ran but the frames are not right (a
 * non-zero exit, a missing or black frame, a fresh crash log) and
 * `blender-timeout` when a batch overran its time limit. The message
 * carries the tail of Blender's standard error and the paths a reader
 * needs (the scene document, the crash log), never a stack trace.
 */
import { VisionForgeError } from './vision-forge-error.ts';

/** The codes the three Blender errors carry. */
export type BlenderErrorCode = 'blender-script' | 'blender-render' | 'blender-timeout';

/** What every Blender error records beyond its message. */
export interface BlenderErrorDetails {
  /** The scene document Blender was applying. */
  readonly scenePath: string;
  /** The last characters of Blender's standard error, on one line; empty when it printed nothing. */
  readonly stderrTail: string;
}

/** The base of the three: a code, the scene path and the stderr tail. */
export class BlenderError extends VisionForgeError {
  readonly scenePath: string;
  readonly stderrTail: string;

  constructor(code: BlenderErrorCode, message: string, hint: string, details: BlenderErrorDetails) {
    super({ code, message, hint });
    this.scenePath = details.scenePath;
    this.stderrTail = details.stderrTail;
  }
}

/** The applier raised a Python exception (exit 3): the scene document or the applier is wrong, not the machine. */
export class BlenderScriptError extends BlenderError {
  constructor(details: BlenderErrorDetails) {
    super(
      'blender-script',
      `blender/apply_scene.py raised an exception while applying ${details.scenePath}.${details.stderrTail.length > 0 ? ` Last output: ${details.stderrTail}` : ''}`,
      'The scene document or the applier is wrong (ADR 0004 decision 7). Open the scene document, read the traceback above, and fix src/lanes/blender/ or blender/apply_scene.py; the machine and the engine are not the cause.',
      details,
    );
  }
}

/** Blender ran but the batch did not render: a non-zero exit, a missing or black frame, or a fresh crash log. */
export class BlenderRenderError extends BlenderError {
  /** The reason the predicate gave, one sentence. */
  readonly reason: string;

  constructor(reason: string, details: BlenderErrorDetails) {
    super(
      'blender-render',
      `Blender did not render ${details.scenePath}: ${reason}${details.stderrTail.length > 0 ? ` Last output: ${details.stderrTail}` : ''}`,
      'At the still gate the next engine of the ladder is tried; at render the pinned engine is the only one, so run still again to pin another, or check the GPU and the driver.',
      details,
    );
    this.reason = reason;
  }
}

/** A batch overran its time limit and was stopped. */
export class BlenderTimeoutError extends BlenderError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, details: BlenderErrorDetails) {
    super(
      'blender-timeout',
      `Blender did not finish ${details.scenePath} within ${Math.round(timeoutMs / 1000)} s and was stopped.`,
      'Run the command again; if it keeps timing out, lower the resolution, pin a GPU engine at the still gate, or shorten the shot.',
      details,
    );
    this.timeoutMs = timeoutMs;
  }
}
