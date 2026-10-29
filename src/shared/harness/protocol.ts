/**
 * The protocol between the Node harness and a lane page in the browser
 * (ADR 0006 decisions 1 and 2). Node builds a ShotPageSpec, opens the page,
 * hands the spec to `window.__vfInit(json)` and then, for every frame,
 * calls `window.__vfSeek(frame)` and takes one screenshot. Both calls
 * return a report as a JSON string so the harness can print the page's
 * own words when something is wrong. Only data lives here: this module is
 * imported by Node and by the browser, so it names no DOM type.
 */
import type { CameraFrame } from '../camera/types.ts';
import type { LookBible } from '../contracts/look-bible.ts';
import type { Shot } from '../contracts/shot-spec.ts';

/** The lanes a browser page can render. */
export type BrowserLane = 'html' | 'three';

/**
 * Everything a page needs to render every frame of one shot as a pure
 * function of the frame number: the shot and its look, the frame size and
 * rate, the camera baked per frame (index = frame), the base distance the
 * composition solver chose (the html stage derives its pixel scale from it)
 * and the URL prefixes the harness serves fonts and assets under.
 */
export interface ShotPageSpec {
  readonly lane: BrowserLane;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly shot: Shot;
  readonly look: LookBible;
  /** One baked camera frame per frame of the shot, in frame order. */
  readonly camera: readonly CameraFrame[];
  /** The camera distance of the base pose in metres (BasePose.distanceM). */
  readonly baseDistanceM: number;
  /** URL prefix of the bundled fonts, for example "/fonts/". */
  readonly fontsUrl: string;
  /** URL prefix of the downloaded assets (HDRIs, models), for example "/assets/". */
  readonly assetsUrl: string;
}

/** What `__vfInit` reports once the page is ready to seek. */
export interface InitReport {
  readonly ok: boolean;
  /** Empty when ok; otherwise one sentence the harness prints. */
  readonly error: string;
  /** The font faces the page loaded, as "family weight" strings. */
  readonly fonts: readonly string[];
  /** document.getAnimations().length after init: anything but 0 is a page-mode violation. */
  readonly animations: number;
  /** UNMASKED_RENDERER_WEBGL of the lane's context, or null for a lane without WebGL. */
  readonly webglRenderer: string | null;
}

/** What `__vfSeek(frame)` reports after render(frame) ran synchronously. */
export interface SeekReport {
  readonly ok: boolean;
  readonly error: string;
  readonly frame: number;
  readonly animations: number;
}

/** The names of the functions the runtime installs on `window`. */
export const pageGlobalNames = {
  /** `__vfInit(specJson: string): Promise<string>`: parses the spec, loads fonts, builds the lane, returns an InitReport as JSON. */
  init: '__vfInit',
  /** `__vfSeek(frame: number): string`: renders the frame synchronously, returns a SeekReport as JSON. */
  seek: '__vfSeek',
} as const;

/** The URL prefix the harness serves the repository's `src/` under, so `/src/browser/...` imports `/src/shared/...` by relative path. */
export const sourceUrlPrefix = '/src/';

/** The URL prefix of the per-shot page directory (index.html). */
export const pageUrlPrefix = '/page/';

/** The URL prefix of the bundled OFL fonts (skills/cinematic-studio/assets/fonts). */
export const fontsUrlPrefix = '/fonts/';

/** The URL prefix of the data directory's downloaded assets. */
export const assetsUrlPrefix = '/assets/';

/** The runtime entry module, relative to the source root; the page's one module script. */
export const runtimeModulePath = 'browser/runtime/boot.ts';

/** The file name of the page inside the page directory. */
export const pageFileName = 'index.html';

/**
 * Element names a page may not contain after init (ADR 0006 decision 1):
 * each one animates or loads on its own clock. The runtime's DOM check
 * reports the first it finds.
 */
export const forbiddenElementNames: readonly string[] = ['video', 'audio', 'iframe', 'animate', 'animatemotion', 'animatetransform', 'set', 'marquee', 'embed', 'object'];

/** The id of the element the lane renders into; the page's body holds nothing else. */
export const rootElementId = 'vf-root';
