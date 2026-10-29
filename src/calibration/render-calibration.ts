/**
 * Renders the calibration scene of ADR 0008 decision 2 in a browser lane
 * under a tone mapping: the page spec of the calibration shot with
 * `scene: 'calibration'`, so the html lane shows the flat patches and the
 * three lane the lit ones, captured at frame 0 into one raw PNG (no grade:
 * the measurement is of the lane's light, not the look's LUT). The look is
 * the obsidian preset with three things changed for the measurement, named
 * on calibrationLook.
 */
import type { Logger } from '../cli/logger.ts';
import type { RendererPolicy } from '../harness/types.ts';
import { resolveEnvironment } from '../render/environment.ts';
import { buildShotPageSpec } from '../render/shot-page-spec.ts';
import type { RenderSpec } from '../shared/camera/types.ts';
import type { LookBible, ToneMapping } from '../shared/contracts/look-bible.ts';
import type { Lighting } from '../shared/contracts/shot-spec.ts';
import type { BrowserLane, EnvironmentRef, ShotPageSpec } from '../shared/harness/protocol.ts';
import { lookPresets } from '../shared/look/presets.ts';
import { renderStill } from './render-still.ts';
import type { StillBrowser, StillRenderResult } from './render-still.ts';
import { calibrationShot, focusedAtSubject } from './shots.ts';

/** The frame rate the calibration page runs at; the scene does not move, so it only sets the sub-frame interval. */
export const calibrationFps = 30;

/**
 * The look the calibration scene renders under: the obsidian preset with
 * the tone mapping asked for, the exposure at 0 EV (the light scalars are
 * defined at toneMappingExposure 1, src/shared/three/exposure.ts) and no
 * halation, because the bloom pass would bleed the white patch into the
 * gray card and the measurement is of the lights alone. The brief named
 * the test fixture's lookBibleExample; the preset stands in for it because
 * src/ cannot import tests/, and the two differ (palette, typography,
 * lightingDefault, grade, QA band). Only the look's background reaches
 * the calibration frame, and the patches cover their boxes, so the
 * measurement does not depend on which of the two it is.
 */
export function calibrationLook(toneMapping: ToneMapping): LookBible {
  const base = lookPresets.obsidian;
  return { ...base, toneMapping, exposureEv: 0, grade: { ...base.grade, halationAmount: 0 } };
}

/** The page spec of the calibration scene on a lane: the calibration shot focused on its subject and baked through the solver, the look above, the scene flag set. */
export function calibrationPageSpec(lane: BrowserLane, toneMapping: ToneMapping, lighting: Lighting, spec: RenderSpec, environment: EnvironmentRef | null): ShotPageSpec {
  return { ...buildShotPageSpec(focusedAtSubject(calibrationShot(lane, lighting), spec), calibrationLook(toneMapping), spec, environment), scene: 'calibration' };
}

/** What renderCalibrationStill needs. */
export interface CalibrationRenderOptions {
  readonly lane: BrowserLane;
  readonly toneMapping: ToneMapping;
  /** The shot's lighting; the scalars are set under product-studio, the fixture's rig. */
  readonly lighting: Lighting;
  readonly dataDir: string;
  readonly outPng: string;
  readonly width: number;
  readonly height: number;
  /** Frames rendered after frame 0 to time a frame; 0 for none. */
  readonly timingFrames: number;
  /** Scratch folder for the page and the timing frames; the caller removes it. */
  readonly workDir: string;
  readonly browser: StillBrowser;
  readonly policy: RendererPolicy;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

/** What the calibration render reports: the still's timings and which environment map the three lane was given. */
export interface CalibrationRenderResult extends StillRenderResult {
  /** The installed HDRI the spec named, or null when the lane fell back to its built-in room environment. */
  readonly environment: EnvironmentRef | null;
}

/** Renders frame 0 of the calibration scene into outPng. */
export async function renderCalibrationStill(options: CalibrationRenderOptions): Promise<CalibrationRenderResult> {
  const spec: RenderSpec = { fps: calibrationFps, width: options.width, height: options.height };
  const environment = resolveEnvironment(calibrationShot(options.lane, options.lighting), options.dataDir);
  const result = await renderStill({
    spec: calibrationPageSpec(options.lane, options.toneMapping, options.lighting, spec, environment),
    frame: 0,
    timingFrames: options.timingFrames,
    outPng: options.outPng,
    dataDir: options.dataDir,
    workDir: options.workDir,
    browser: options.browser,
    policy: options.policy,
    log: options.log,
    signal: options.signal,
  });
  return { ...result, environment };
}
