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
 * What doctor found on this machine: platform, Node, external programs, browsers, GPU, which lanes can run and whether narration is installed. Written as tools.json under the data directory.
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
    blender?: Program;
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
     * True when the HTML/CSS lane can run: a browser and ffmpeg were found.
     */
    html: boolean;
    /**
     * True when the Three.js lane can run: a browser with WebGL2 and ffmpeg were found.
     */
    three: boolean;
    /**
     * True when the Blender lane can run: a supported Blender and ffmpeg were found.
     */
    blender: boolean;
    /**
     * True when audio can be assembled: ffmpeg with the required encoders was found.
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
     * True when the installed model weights matched their pinned checksums.
     */
    weightsVerified: boolean;
  };
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
   * Version as ffmpeg reports it, for example "7.1.1".
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
 * A browser that was found and can be launched.
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
}

/** Every OperatingSystem value the schema allows, in schema order. */
export const OperatingSystemValues = ['win32', 'darwin', 'linux'] as const;

/** Every Channel value the schema allows, in schema order. */
export const ChannelValues = ['msedge', 'chrome'] as const;
