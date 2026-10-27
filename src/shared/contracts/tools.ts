/** @generated from schemas/tools.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Operating system as Node reports it (process.platform).
 *
 * This interface was referenced by `ToolsManifest`'s JSON-Schema
 * via the `definition` "OperatingSystem".
 */
export type OperatingSystem = 'win32' | 'darwin' | 'linux';
/**
 * Browser channel as Playwright's launch option names it: msedge is Microsoft Edge, chrome is Google Chrome.
 *
 * This interface was referenced by `ToolsManifest`'s JSON-Schema
 * via the `definition` "Channel".
 */
export type Channel = 'msedge' | 'chrome';

/**
 * What doctor found on this machine: platform, Node, external programs, browsers with their WebGL report, GPU, which lanes can run, whether narration is installed and what is wrong. Written as tools.json under the data directory.
 */
export interface ToolsManifest {
  /**
   * Document kind; always "tools".
   */
  kind: 'tools';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * When doctor wrote this manifest: an RFC 3339 timestamp in UTC with millisecond precision, for example 2026-10-26T20:00:00.000Z.
   */
  generatedAt: string;
  /**
   * The operating system doctor ran on.
   */
  platform: {
    os: OperatingSystem;
    /**
     * CPU architecture as Node reports it (process.arch), for example "x64" or "arm64".
     */
    arch: string;
    /**
     * Operating system release as Node reports it (os.release()), for example "10.0.26300".
     */
    release: string;
  };
  /**
   * The Node runtime doctor ran under; every command uses the same one.
   */
  node: {
    /**
     * Absolute path of the node executable (process.execPath).
     */
    path: string;
    /**
     * Node version including the leading v, for example "v24.13.0".
     */
    version: string;
  };
  /**
   * True when doctor ran in an interactive desktop session, where a browser can open a window and reach the GPU; false in a service or CI session.
   */
  interactiveSession: boolean;
  /**
   * Windows LongPathsEnabled registry value as a boolean; null on other platforms or when the value could not be read.
   */
  longPathsEnabled: boolean | null;
  /**
   * The external programs that were found. A program that was not found is a missing property, never null.
   */
  programs: {
    ffmpeg?: FfmpegProgram;
    ffprobe?: Program;
    blender?: BlenderProgram;
  };
  /**
   * The browsers that were found, in launch preference order (Edge before Chrome); empty when none was found.
   */
  browsers: Browser[];
  /**
   * The graphics adapter and its driver; null when none could be identified.
   */
  gpu: {
    /**
     * Adapter name as the driver reports it, for example "NVIDIA GeForce RTX 4080".
     */
    name: string;
    /**
     * Driver version as the driver reports it, for example "581.57".
     */
    driver: string;
  } | null;
  /**
   * Which render lanes can run on this machine, given the programs and browsers found.
   */
  lanes: {
    /**
     * True when the HTML/CSS lane can run: a browser, ffmpeg with the required filters and encoders, and ffprobe were found.
     */
    html: boolean;
    /**
     * True when the Three.js lane can run: the html lane can run and a browser reported a WebGL2 context.
     */
    three: boolean;
    /**
     * True when the Blender lane can run: ffmpeg with the required filters and a supported Blender (5.2.x) were found and the probe, when it ran, succeeded.
     */
    blender: boolean;
    /**
     * True when audio can be assembled: ffmpeg with the aac and pcm_s16le encoders was found.
     */
    audio: boolean;
  };
  /**
   * State of the optional narration component (ADR 0007).
   */
  narration: {
    /**
     * True when the narration component is installed under the data directory.
     */
    installed: boolean;
    /**
     * True when model-source.json under the narration component records verified: true (written by audio install, milestone M6).
     */
    weightsVerified: boolean;
  };
  /**
   * What doctor found wrong, one sentence each: missing ffmpeg filters or encoders, an unsupported Blender version, a failed Blender probe, a non-interactive session. Empty when nothing is wrong.
   *
   * Items: One problem sentence, for example "ffmpeg is missing the required filter xfade."
   */
  problems: string[];
}
/**
 * The ffmpeg program that was found, with the filters and encoders this build offers.
 *
 * This interface was referenced by `ToolsManifest`'s JSON-Schema
 * via the `definition` "FfmpegProgram".
 */
export interface FfmpegProgram {
  /**
   * Absolute path of the ffmpeg executable.
   */
  path: string;
  /**
   * Version as the first line of ffmpeg -version reports it, for example "9.0.2-full_build-www.gyan.dev" or "7.1.1".
   */
  version: string;
  /**
   * SHA-256 of the executable file as 64 lowercase hex characters; present when doctor computed it.
   */
  sha256?: string;
  /**
   * Names of the filters this ffmpeg build offers (ffmpeg -filters), for example "lut3d" or "drawtext".
   *
   * Items: One filter name.
   */
  filters: string[];
  /**
   * Names of the encoders this ffmpeg build offers (ffmpeg -encoders), for example "libx264" or "aac".
   *
   * Items: One encoder name.
   */
  encoders: string[];
}
/**
 * An external program that was found.
 *
 * This interface was referenced by `ToolsManifest`'s JSON-Schema
 * via the `definition` "Program".
 */
export interface Program {
  /**
   * Absolute path of the executable.
   */
  path: string;
  /**
   * Version as the program reports it, for example "7.1.1".
   */
  version: string;
  /**
   * SHA-256 of the executable file as 64 lowercase hex characters; present when doctor computed it.
   */
  sha256?: string;
}
/**
 * The Blender program that was found, with what the Python probe reported. The probe fields (python, engines, computeDeviceTypes, devices, actionSlots, mediaType) are present together when the probe ran and succeeded, and absent when it was skipped (--skip-blender-probe) or failed; a failed probe is listed under problems.
 *
 * This interface was referenced by `ToolsManifest`'s JSON-Schema
 * via the `definition` "BlenderProgram".
 */
export interface BlenderProgram {
  /**
   * Absolute path of the blender executable (blender.exe on Windows), never a launcher or a Microsoft Store alias.
   */
  path: string;
  /**
   * Version as the first line of blender --version reports it, without the LTS suffix, for example "5.2.3".
   */
  version: string;
  /**
   * SHA-256 of the blender executable file as 64 lowercase hex characters; present when doctor computed it.
   */
  sha256?: string;
  /**
   * sys.version of the Python bundled with Blender, for example "3.13.5 (main, Jul 10 2026, 12:00:00) [MSC v.1943 64 bit (AMD64)]".
   */
  python?: string;
  /**
   * Render engine identifiers from RenderSettings.engine, for example ["BLENDER_EEVEE", "BLENDER_WORKBENCH", "CYCLES"].
   *
   * Items: One render engine identifier, for example "CYCLES".
   */
  engines?: string[];
  /**
   * Cycles compute device types this build offers (CyclesPreferences.get_device_types), for example ["NONE", "CUDA", "OPTIX"].
   *
   * Items: One compute device type identifier, for example "OPTIX".
   */
  computeDeviceTypes?: string[];
  /**
   * Cycles devices after refresh_devices(), in the order Blender lists them; the CPU is always one of them.
   *
   * Items: One Cycles device.
   */
  devices?: {
    /**
     * Device name as Blender reports it, for example "NVIDIA GeForce RTX 2060".
     */
    name: string;
    /**
     * Device type as Blender reports it, for example "OPTIX", "CUDA" or "CPU".
     */
    type: string;
  }[];
  /**
   * True when bpy.types.Action has the slots property (the 5.x animation API, ADR 0004).
   */
  actionSlots?: boolean;
  /**
   * True when bpy.types.ImageFormatSettings has the media_type property (5.x; it must be set before file_format).
   */
  mediaType?: boolean;
}
/**
 * A browser that was found and can be launched, with what its WebGL context reported.
 *
 * This interface was referenced by `ToolsManifest`'s JSON-Schema
 * via the `definition` "Browser".
 */
export interface Browser {
  channel: Channel;
  /**
   * Absolute path of the browser executable.
   */
  path: string;
  /**
   * Full browser version, four dotted numbers, for example "156.0.3700.42".
   */
  version: string;
  /**
   * What a WebGL context in this browser reported when doctor launched it headless with a 640x360 viewport at device scale factor 1; null when the check was skipped (--skip-browser-check) or failed.
   */
  webgl: {
    /**
     * UNMASKED_RENDERER_WEBGL as the browser reports it, for example "ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11)".
     */
    renderer: string;
    /**
     * UNMASKED_VENDOR_WEBGL as the browser reports it, for example "Google Inc. (NVIDIA)".
     */
    vendor: string;
    /**
     * True when a WebGL2 context could be created; false when only WebGL1 was available.
     */
    webgl2: boolean;
    /**
     * True when the renderer names a GPU vendor (NVIDIA, AMD, Radeon, Intel, Apple, Qualcomm) and not a software rasterizer (SwiftShader, SwANGLE, WARP, Microsoft Basic Render Driver, llvmpipe).
     */
    hardware: boolean;
    /**
     * True when the EXT_color_buffer_float extension is available (float render targets for post-processing).
     */
    extColorBufferFloat: boolean;
  } | null;
}

/** Every OperatingSystem value the schema allows, in schema order. */
export const OperatingSystemValues = ['win32', 'darwin', 'linux'] as const;

/** Every Channel value the schema allows, in schema order. */
export const ChannelValues = ['msedge', 'chrome'] as const;
