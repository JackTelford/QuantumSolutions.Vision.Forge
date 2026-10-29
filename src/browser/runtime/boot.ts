/**
 * The page's one module script. It installs the two globals of
 * shared/harness/protocol.ts: `__vfInit(specJson)` parses the spec, loads
 * the look's fonts, disposes the previous lane, builds the lane (awaiting
 * what it loads), reads the WebGL renderer and runs the DOM check; `__vfSeek(frame)` renders one
 * frame synchronously. Both return
 * a report as JSON and never throw: the harness prints the page's own
 * sentence when something is wrong.
 */
import type { InitReport, SeekReport, ShotPageSpec, TextOverflow } from '../../shared/harness/protocol.ts';
import { pageGlobalNames, rootElementId } from '../../shared/harness/protocol.ts';
import { HtmlLane } from '../html/lane.ts';
import { ThreeLane } from '../three/lane.ts';
import { checkDom } from './dom-check.ts';
import { loadLookFonts } from './fonts.ts';
import type { LaneModule } from './lane-module.ts';
import { readWebglRenderer } from './webgl-renderer.ts';

/** What init leaves behind for seek. */
interface RuntimeState {
  readonly spec: ShotPageSpec;
  readonly lane: LaneModule;
}

let state: RuntimeState | undefined;

/** The lane of the last init, kept even when that init failed, so its GPU context is freed before the next lane takes one. */
let previousLane: LaneModule | undefined;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The lane for the spec; a lane this page cannot render (blender, or a misspelling) fails with a sentence. */
function laneFor(spec: ShotPageSpec): LaneModule {
  if (spec.lane === 'html') return new HtmlLane();
  if (spec.lane === 'three') return new ThreeLane();
  throw new Error(`The lane ${String(spec.lane)} is not a browser lane.`);
}

/** The parsed JSON as a ShotPageSpec, or an error in a sentence when a top-level field is missing (a property-access message would name nothing useful). */
function parseSpec(specJson: string): ShotPageSpec {
  const parsed: unknown = JSON.parse(specJson);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The spec is not a ShotPageSpec (lane, shot, look and camera are required).');
  const spec = parsed as Partial<ShotPageSpec>;
  if (spec.lane === undefined || spec.shot === undefined || spec.look === undefined || !Array.isArray(spec.camera)) {
    throw new Error('The spec is not a ShotPageSpec (lane, shot, look and camera are required).');
  }
  return spec as ShotPageSpec;
}

/** Parses the spec, loads fonts, reads the renderer, builds the lane and checks the DOM; any failure is reported, never thrown. */
async function init(specJson: string): Promise<InitReport> {
  let fonts: readonly string[] = [];
  let webglRenderer: string | null = null;
  let animations = 0;
  let textOverflows: readonly TextOverflow[] = [];
  // A second init replaces the page, so the lane of the first must not be sought even when the second fails.
  state = undefined;
  try {
    const spec = parseSpec(specJson);
    const fontResult = await loadLookFonts(document.fonts, spec.look.typography);
    fonts = fontResult.loaded;
    const root = document.getElementById(rootElementId);
    if (root === null) throw new Error(`The page has no #${rootElementId} element.`);
    // The previous lane's WebGL context would otherwise live until GC, and Chromium caps live contexts per page.
    previousLane?.dispose?.();
    previousLane = undefined;
    const lane = laneFor(spec);
    previousLane = lane;
    await lane.init(spec, root);
    // The lane's own context names the renderer that draws; a lane without one (html) is probed with a throwaway context.
    webglRenderer = lane.webglRenderer === undefined ? readWebglRenderer(document) : lane.webglRenderer();
    // The text is measured in its shown state first; frame 0 is then drawn before the DOM check so the check sees the full page.
    textOverflows = lane.measureText === undefined ? [] : lane.measureText();
    lane.render(0);
    const check = checkDom(document);
    animations = check.animations;
    if (fontResult.failed.length > 0) return { ok: false, error: `The font face ${fontResult.failed.join(', ')} did not load.`, fonts, animations, webglRenderer, textOverflows };
    if (check.problem !== null) return { ok: false, error: check.problem, fonts, animations, webglRenderer, textOverflows };
    // Only a page that passed both verdicts may be sought, so the report and the page agree.
    state = { spec, lane };
    return { ok: true, error: '', fonts, animations, webglRenderer, textOverflows };
  } catch (error: unknown) {
    return { ok: false, error: messageOf(error), fonts, animations, webglRenderer, textOverflows };
  }
}

/** Renders the frame synchronously and reports; fails with a sentence when init has not run. */
function seek(frame: number): SeekReport {
  if (state === undefined) return { ok: false, error: 'Call __vfInit before __vfSeek.', frame, animations: 0 };
  try {
    state.lane.render(frame);
    const check = checkDom(document);
    return { ok: check.problem === null, error: check.problem ?? '', frame, animations: check.animations };
  } catch (error: unknown) {
    return { ok: false, error: messageOf(error), frame, animations: 0 };
  }
}

const globals = window as unknown as Record<string, unknown>;
globals[pageGlobalNames.init] = (specJson: string): Promise<string> => init(specJson).then((report) => JSON.stringify(report));
globals[pageGlobalNames.seek] = (frame: number): string => JSON.stringify(seek(frame));
