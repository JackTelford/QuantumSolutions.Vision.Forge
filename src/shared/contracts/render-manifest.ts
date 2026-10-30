/** @generated from schemas/render-manifest.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Which lane rendered the shot: html (HTML/CSS in a browser), three (Three.js WebGL in a browser) or blender.
 *
 * This interface was referenced by `RenderManifest`'s JSON-Schema
 * via the `definition` "Lane".
 */
export type Lane = 'html' | 'three' | 'blender';
/**
 * What the frames hold (ADR 0008, decision 4): picture (the whole frame, the default when absent) or text (the html lane's text overlay alone over transparency, rendered under its own key for a three or blender shot and composited over the graded picture).
 *
 * This interface was referenced by `RenderManifest`'s JSON-Schema
 * via the `definition` "Plate".
 */
export type Plate = 'picture' | 'text';
/**
 * Whether the GPU (hardware) or a CPU rasterizer such as SwiftShader (software) produced the pixels.
 *
 * This interface was referenced by `RenderManifest`'s JSON-Schema
 * via the `definition` "Renderer".
 */
export type Renderer = 'hardware' | 'software';
/**
 * Where the render stands: rendering (frames still being produced), complete (every frame hashed) or failed.
 *
 * This interface was referenced by `RenderManifest`'s JSON-Schema
 * via the `definition` "RenderStatus".
 */
export type RenderStatus = 'rendering' | 'complete' | 'failed';

/**
 * What one shot render produced and under which fingerprint (ADR 0006). Written as manifest.json next to the frames; a complete manifest is what makes a cached shot reusable.
 */
export interface RenderManifest {
  /**
   * Document kind; always "render-manifest".
   */
  kind: 'render-manifest';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * Identifier of the shot in its shot spec, for example "s01".
   */
  shotId: string;
  /**
   * Shot hash as 64 lowercase hex characters: SHA-256 over the browser major version, the launch flags, the lane code hash, the shot spec, the look bible and the render profile (ADR 0006, decision 8). Names the cache folder.
   */
  key: string;
  lane: Lane;
  plate?: Plate;
  /**
   * How the lane rendered: the engine, its backend and whether a hardware or software renderer produced the pixels.
   */
  renderProfile: {
    /**
     * Rendering engine, for example "chromium" for the browser lanes, "cycles" or "eevee" for Blender.
     */
    engine: string;
    /**
     * Graphics backend the engine used: the ANGLE backend such as "d3d11" or "swiftshader-webgl" for browsers, the compute device such as "CUDA" or "CPU" for Blender.
     */
    backend: string;
    renderer: Renderer;
  };
  /**
   * Everything that influences pixels (ADR 0006, decision 5). Two renders with equal fingerprints on the same machine produce byte-identical frames.
   */
  fingerprint: {
    /**
     * The browser the html and three lanes rendered in; absent for the blender lane.
     */
    browser?: {
      /**
       * Browser channel that was launched, "msedge" or "chrome", as the tools manifest records it.
       */
      channel: string;
      /**
       * Full browser version, four dotted numbers, for example "156.0.3700.42".
       */
      version: string;
      /**
       * Launch flags passed to the browser, in order, for example "--use-angle=d3d11".
       *
       * Items: One launch flag.
       */
      args: string[];
    };
    /**
     * UNMASKED_RENDERER_WEBGL string read from the browser at startup; absent for the blender lane.
     */
    webglRenderer?: string;
    /**
     * Windows AppliedDPI registry value in dots per inch (96 at 100% scaling); absent on other platforms.
     */
    appliedDpi?: number;
    /**
     * The four Windows ClearType registry values that shape text anti-aliasing; absent on other platforms.
     */
    clearType?: {
      /**
       * FontSmoothing registry value as a decimal string; "2" when smoothing is on.
       */
      fontSmoothing: string;
      /**
       * FontSmoothingType registry value as a decimal string; "2" for ClearType.
       */
      fontSmoothingType: string;
      /**
       * FontSmoothingOrientation registry value as a decimal string (the subpixel order).
       */
      orientation: string;
      /**
       * FontSmoothingGamma registry value as a decimal string, 1000 to 2200.
       */
      gamma: string;
    };
    /**
     * Node version including the leading v, for example "v24.13.0".
     */
    node: string;
    /**
     * three.js version, for example "0.186.1"; absent unless the three lane rendered.
     */
    three?: string;
    /**
     * Version as ffmpeg reports it, for example "7.1.1".
     */
    ffmpeg: string;
    /**
     * Blender version, for example "4.2.3"; absent unless the blender lane rendered.
     */
    blender?: string;
  };
  /**
   * Frame rate in frames per second.
   */
  fps: number;
  /**
   * Frame width in pixels.
   */
  width: number;
  /**
   * Frame height in pixels.
   */
  height: number;
  /**
   * Number of frames the shot has in total; frames lists the ones rendered so far.
   */
  frameCount: number;
  /**
   * The rendered frames in index order; grows while status is rendering and has frameCount entries when complete.
   *
   * Items: One rendered frame and the hash of its pixels.
   */
  frames: {
    /**
     * Zero-based frame number.
     */
    index: number;
    /**
     * SHA-256 of the decoded pixels from ffmpeg framehash, never of the PNG bytes, as 64 lowercase hex characters.
     */
    sha256: string;
  }[];
  status: RenderStatus;
  /**
   * When the render started: an RFC 3339 timestamp in UTC with millisecond precision, for example 2026-10-26T20:00:00.000Z.
   */
  startedAt: string;
  /**
   * When the render became complete or failed, in the same RFC 3339 form as startedAt; absent while rendering.
   */
  finishedAt?: string;
  /**
   * SHA-256 of the canonical JSON of fingerprint, as 64 lowercase hex characters; equal fingerprints hash alike.
   */
  toolVersionsHash: string;
}

/** Every Lane value the schema allows, in schema order. */
export const LaneValues = ['html', 'three', 'blender'] as const;

/** Every Renderer value the schema allows, in schema order. */
export const RendererValues = ['hardware', 'software'] as const;

/** Every Plate value the schema allows, in schema order. */
export const PlateValues = ['picture', 'text'] as const;

/** Every RenderStatus value the schema allows, in schema order. */
export const RenderStatusValues = ['rendering', 'complete', 'failed'] as const;
