/**
 * The text plate of a three or blender shot (ADR 0008 decision 4): the
 * shot's text elements rendered by the html lane over a transparent page,
 * captured with alpha, cached under a key of their own and laid over the
 * graded picture by the still (src/render/finish-still.ts) and by the
 * assembly (src/assemble/). An html shot draws its text on its own picture
 * and has no text plate; neither has a shot without text elements.
 *
 * The plate's key folds the html lane's fingerprint into the shot key, so
 * a change to the html lane's code or to the browser re-keys the plate
 * while the picture cache stays untouched, and a change to the shot or the
 * look (already in the shot key) re-keys both. The plate renders through
 * renderShot like any shot, so it resumes from its manifest and reuses
 * finished frames.
 */
import type { Logger } from '../cli/logger.ts';
import type { BrowserRenderer, RendererPolicy } from '../harness/types.ts';
import type { RenderFingerprint } from '../plan/shot-key.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { RenderSpec } from '../shared/camera/types.ts';
import type { LookBible } from '../shared/contracts/look-bible.ts';
import type { Shot } from '../shared/contracts/shot-spec.ts';
import type { InitReport } from '../shared/harness/protocol.ts';
import { contentHash } from '../shared/sha256.ts';
import { readRenderTools } from './command-support.ts';
import type { RenderTools } from './command-support.ts';
import type { ManifestFingerprint } from './manifest.ts';
import { renderShot } from './render-shot.ts';
import type { RenderShotResult } from './render-shot.ts';
import { loadRealSeams } from './seams.ts';
import type { HarnessHandle, RenderSeams } from './seams.ts';
import { buildShotPageSpec } from './shot-page-spec.ts';

/** True when the shot's words render as a plate of their own: a three or blender shot with at least one text element. */
export function hasTextPlate(shot: Shot): boolean {
  return shot.lane !== 'html' && shot.text.length > 0;
}

/** What a text plate's key is the content hash of: the picture's key, the plate's name and the html lane's fingerprint (its code hash, the browser major and the launch flags). */
export interface TextPlateKeyInput {
  readonly shotKey: string;
  readonly plate: 'text';
  readonly laneCodeHash: string;
  readonly browserMajor: number | null;
  readonly browserFlags: readonly string[];
}

/** The key of a shot's text plate, as 64 lowercase hex characters; `fingerprint` is the html lane's (src/plan/shot-key.ts laneFingerprint or src/render/command-support.ts keyFingerprint). */
export function textPlateKey(shotKey: string, fingerprint: RenderFingerprint): Promise<string> {
  const input: TextPlateKeyInput = { shotKey, plate: 'text', laneCodeHash: fingerprint.laneCodeHash, browserMajor: fingerprint.browserMajor, browserFlags: fingerprint.browserFlags };
  return contentHash(input);
}

/** The text plate's frame kept beside a still: the still's path with `.text.png` in place of `.png`. */
export function textStillPath(finishedPng: string): string {
  return finishedPng.replace(/\.png$/i, '') + '.text.png';
}

/** What rendering a text plate needs of the command's context. */
export interface TextPlateContext {
  readonly dataDir: string;
  readonly runner: ProcessRunner;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly now: () => Date;
}

/** An open browser over a running harness, as the text plates of a command render through it. */
export interface TextPlateSession {
  readonly renderer: BrowserRenderer;
  readonly harness: HarnessHandle;
  readonly seams: RenderSeams;
  readonly tools: RenderTools;
  /** The page directory the harness serves under /page/; the plate's page is written there before each capture. */
  readonly pageDir: string;
  /** The html lane's manifest fingerprint in this browser, read on the first plate and kept for the rest. */
  fingerprint: ManifestFingerprint | undefined;
}

/** Starts a harness over the page directory and opens the browser at the spec's size; the caller closes both with closeTextPlateSession. */
export async function openTextPlateSession(context: TextPlateContext, spec: RenderSpec, policy: RendererPolicy, pageDir: string): Promise<TextPlateSession> {
  const tools = readRenderTools(context.dataDir);
  const seams = await loadRealSeams();
  const harness = await seams.startHarness({ pageDir, dataDir: context.dataDir, log: context.log, signal: context.signal });
  let renderer: BrowserRenderer;
  try {
    renderer = await seams.openRenderer({ browser: tools.browser, policy, width: spec.width, height: spec.height, dataDir: context.dataDir, log: context.log, signal: context.signal });
  } catch (error: unknown) {
    await harness.stop();
    throw error;
  }
  context.log.info(`text plates render with ${tools.browser.channel} ${tools.browser.version}, renderer ${renderer.profile.renderer} (${renderer.profile.backend})`);
  return { renderer, harness, seams, tools, pageDir, fingerprint: undefined };
}

/** Closes the session's browser and stops its harness. */
export async function closeTextPlateSession(session: TextPlateSession): Promise<void> {
  await session.renderer.close();
  await session.harness.stop();
}

/** The html lane's manifest fingerprint of the session, read once. */
async function sessionFingerprint(session: TextPlateSession, context: TextPlateContext): Promise<ManifestFingerprint> {
  if (session.fingerprint === undefined) {
    session.fingerprint = await session.seams.manifestFingerprint({ renderer: session.renderer, lane: 'html', ffmpegVersion: session.tools.ffmpeg.version, runner: context.runner, signal: context.signal });
  }
  return session.fingerprint;
}

/** What one text plate render asks for. */
export interface TextPlateRender {
  readonly shot: Shot;
  readonly look: LookBible;
  readonly spec: RenderSpec;
  /** The frames to render, in the order to capture them. */
  readonly frames: readonly number[];
  /** The plate's key (textPlateKey), which names its cache folder. */
  readonly key: string;
  readonly cacheDir: string;
  /** Receives the page's init report, whose text measurements the still gate reads. */
  readonly onInit?: (report: InitReport) => void;
}

/** Renders the frames of the shot's text plate into its cache through the session, resumable like any shot; the manifest records lane html and plate text. */
export async function renderTextPlate(session: TextPlateSession, context: TextPlateContext, render: TextPlateRender): Promise<RenderShotResult> {
  const fingerprint = await sessionFingerprint(session, context);
  return renderShot({
    renderer: session.renderer, page: session.seams, harnessUrl: session.harness.url, pageDir: session.pageDir, shot: render.shot, look: render.look, spec: render.spec, frames: render.frames,
    cacheDir: render.cacheDir, key: render.key, fingerprint, runner: context.runner, ffmpegPath: session.tools.ffmpeg.path, log: context.log, signal: context.signal, now: context.now,
    // A text plate has no environment map: the html lane lights nothing on a text plate.
    environment: null, plate: 'text',
    ...(render.onInit === undefined ? {} : { onInit: render.onInit }),
  });
}

/** Captures one frame of the shot's text plate straight into a PNG, outside the cache: the scaled hero still is never cached, so its plate is not either. The session's browser must be open at the spec's size. */
export async function captureTextPlateFrame(session: TextPlateSession, context: TextPlateContext, shot: Shot, look: LookBible, spec: RenderSpec, frame: number, outPng: string): Promise<void> {
  session.seams.writeShotPage(session.pageDir, spec.width, spec.height);
  await session.renderer.capture({ pageUrl: session.seams.pageUrl(session.harness.url), spec: buildShotPageSpec(shot, look, spec, null, 'text'), frames: [frame], framePath: (): string => outPng }, context.signal);
}
