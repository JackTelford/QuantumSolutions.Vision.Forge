/**
 * The attempt ladder of ADR 0004 decision 6. A still tries, in order,
 * EEVEE on OpenGL, EEVEE on Vulkan, Cycles on OptiX, Cycles on CUDA and
 * Cycles on the CPU, skipping the rungs this machine cannot take (no OptiX
 * device, no CUDA device, no interactive session for EEVEE) and the EEVEE
 * rungs for a 4K still, which goes straight to Cycles with denoising. The
 * rung that renders is pinned into the shot spec as its render profile
 * (engine, backend, hardware or software). A render runs the pinned rung
 * and no other: switching engines would change the pixels the still was
 * approved on, so a profile that is not a Blender rung, or the CPU rung
 * (legal for stills only), is refused with the same code the browser lanes
 * use for a renderer that disagrees with the pin.
 */
import type { Logger } from '../../cli/logger.ts';
import { BlenderError } from '../../errors/blender-errors.ts';
import { VisionForgeError } from '../../errors/vision-forge-error.ts';
import type { RendererPolicy } from '../../harness/types.ts';
import { RenderProfileMismatchError } from '../../render/command-support.ts';
import type { RenderProfile } from '../../shared/contracts/shot-spec.ts';
import { defaultSamples, stillWidth4k } from './render-settings.ts';
import type { AttemptEngine, BlenderAttempt } from './render-settings.ts';
import type { GpuBackend } from './runner.ts';

/** What a still or a render is being made for; a still gets more samples and denoising (render-settings.ts). */
export type RenderPurpose = 'still' | 'render';

/** The backend a rung records in the render profile: EEVEE's GPU backend or Cycles' compute device. */
export type BlenderBackend = GpuBackend | 'OPTIX' | 'CUDA' | 'CPU';

/** One rung of the ladder. */
export interface LadderRung {
  readonly engine: AttemptEngine;
  readonly backend: BlenderBackend;
}

/** The ladder, top to bottom. */
export const stillLadder: readonly LadderRung[] = [
  { engine: 'eevee', backend: 'opengl' },
  { engine: 'eevee', backend: 'vulkan' },
  { engine: 'cycles', backend: 'OPTIX' },
  { engine: 'cycles', backend: 'CUDA' },
  { engine: 'cycles', backend: 'CPU' },
];

/** One attempt of the ladder, ready to render: its profile, the attempt the resolver takes and the GPU backend the runner names. */
export interface LadderAttempt {
  /** "eevee-opengl", "cycles-CPU": the folder and log name of the attempt. */
  readonly name: string;
  readonly rung: LadderRung;
  readonly profile: RenderProfile;
  readonly attempt: BlenderAttempt;
  readonly gpuBackend: GpuBackend | null;
  /** Still or render: the resolver denoises a still and never a clip's batch, however short the batch (a one-frame batch of a clip is not a still). */
  readonly purpose: RenderPurpose;
}

/** The render profile a rung pins: the CPU rung is the software renderer, every other rung renders on the GPU. */
export function rungProfile(rung: LadderRung): RenderProfile {
  return { engine: rung.engine, backend: rung.backend, renderer: rung.backend === 'CPU' ? 'software' : 'hardware' };
}

/** "eevee-opengl" for a rung. */
export function rungName(rung: LadderRung): string {
  return `${rung.engine}-${rung.backend}`;
}

/** The rung a pinned profile names, or undefined when the profile is not one of the ladder's (a browser profile, a misspelt backend). */
export function parseBlenderProfile(profile: RenderProfile): LadderRung | undefined {
  const rung = stillLadder.find((candidate) => candidate.engine === profile.engine && candidate.backend === profile.backend);
  return rung !== undefined && rungProfile(rung).renderer === profile.renderer ? rung : undefined;
}

/** The attempt of a rung for a purpose: the engine, its device (null for EEVEE) and the samples of render-settings.ts. */
export function ladderAttempt(rung: LadderRung, purpose: RenderPurpose, width: number): LadderAttempt {
  const eevee = rung.engine === 'eevee';
  return {
    name: rungName(rung),
    rung,
    profile: rungProfile(rung),
    attempt: { engine: rung.engine, device: eevee ? null : (rung.backend as 'OPTIX' | 'CUDA' | 'CPU'), samples: defaultSamples(rung.engine, purpose === 'still', width) },
    gpuBackend: eevee ? (rung.backend as GpuBackend) : null,
    purpose,
  };
}

/** What narrows the ladder for a still. */
export interface StillLadderOptions {
  readonly width: number;
  /** The Cycles device types doctor's probe recorded (tools.json devices[].type); empty when the probe was skipped, which leaves the CPU rung only among the Cycles rungs. */
  readonly deviceTypes: readonly string[];
  /** EEVEE needs a desktop session for its GPU context (ADR 0004); without one its rungs are skipped. */
  readonly interactiveSession: boolean;
  /** --renderer: hardware keeps the GPU rungs, software the CPU rung, any every rung. */
  readonly policy: RendererPolicy;
}

/** True when a rung can be tried on this machine for this still. */
export function rungAllowed(rung: LadderRung, options: StillLadderOptions): boolean {
  const profile = rungProfile(rung);
  if (options.policy !== 'any' && options.policy !== profile.renderer) return false;
  if (rung.engine === 'eevee') return options.interactiveSession && options.width < stillWidth4k;
  if (rung.backend === 'CPU') return true;
  return options.deviceTypes.includes(rung.backend);
}

/** The attempts a still tries, in ladder order; empty when nothing on this machine fits the policy. */
export function stillAttempts(options: StillLadderOptions): readonly LadderAttempt[] {
  return stillLadder.filter((rung) => rungAllowed(rung, options)).map((rung) => ladderAttempt(rung, 'still', options.width));
}

/** The one attempt a render makes: the pinned profile, which must be a GPU rung of the ladder and must agree with a fixed --renderer, as the browser lanes' pins must (command-support.ts effectivePolicy). */
export function renderAttempt(shotId: string, pinned: RenderProfile | null, width: number, policy: RendererPolicy): LadderAttempt {
  if (pinned === null) {
    throw new RenderProfileMismatchError(`Shot "${shotId}" has no render profile pinned, so render does not know which Blender engine the still was approved on.`);
  }
  const rung = parseBlenderProfile(pinned);
  if (rung === undefined) {
    throw new RenderProfileMismatchError(`Shot "${shotId}" is pinned to ${pinned.engine} on ${pinned.backend}, which is not a Blender engine; run still again on the blender lane to pin one.`);
  }
  if (rung.backend === 'CPU') {
    throw new RenderProfileMismatchError(`Shot "${shotId}" is pinned to Cycles on the CPU, which is legal for stills only (ADR 0004 decision 6); plan the shot on a GPU engine (run still again on a machine with a GPU, or with an interactive session for EEVEE) or on another lane.`);
  }
  if (policy !== 'any' && policy !== pinned.renderer) {
    throw new RenderProfileMismatchError(`Shot "${shotId}" was pinned to the ${pinned.renderer} renderer (${pinned.engine} on ${pinned.backend}) by the still gate, but --renderer ${policy} was asked for.`);
  }
  return ladderAttempt(rung, 'render', width);
}

/** What the ladder produced: the attempt that rendered and whatever the attempt returned. */
export interface LadderOutcome<T> {
  readonly attempt: LadderAttempt;
  readonly value: T;
}

/**
 * Tries the attempts in order until one renders. A BlenderError from an
 * attempt is logged with its reason and the next attempt is tried; any
 * other error (cancellation, a broken ffmpeg, a programming error) stops
 * the ladder at once. When every attempt fails the last error is thrown,
 * so the CLI reports why the bottom rung failed.
 */
export async function runLadder<T>(attempts: readonly LadderAttempt[], tryAttempt: (attempt: LadderAttempt) => Promise<T>, log: Logger): Promise<LadderOutcome<T>> {
  if (attempts.length === 0) {
    throw new VisionForgeError({
      code: 'blender-render',
      message: 'No Blender engine can be tried on this machine under the renderer policy.',
      hint: 'EEVEE needs an interactive desktop session, Cycles on the GPU needs an OptiX or CUDA device in doctor\'s probe (run doctor without --skip-blender-probe), and --renderer software leaves only the CPU.',
    });
  }
  let last: BlenderError | undefined;
  for (const attempt of attempts) {
    log.info(`blender attempt ${attempt.name}: ${attempt.attempt.samples} samples`);
    try {
      return { attempt, value: await tryAttempt(attempt) };
    } catch (error: unknown) {
      if (!(error instanceof BlenderError)) throw error;
      log.warn(`blender attempt ${attempt.name} failed (${error.code}): ${error.message}`);
      last = error;
    }
  }
  if (last === undefined) throw new Error('The ladder ran out of attempts without an error.');
  throw last;
}
