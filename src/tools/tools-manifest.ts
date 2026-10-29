/**
 * The tools manifest: what doctor found, assembled from the discovery
 * modules in this directory, validated against schemas/tools.schema.json and
 * written as tools.json under the data directory. Every later command reads
 * it instead of discovering programs again.
 */
import { componentStatus } from '../audio/component.ts';
import { existsSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '../cli/logger.ts';
import { DataFileError } from '../errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../fs/atomic-json.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { validateDocument } from '../schema/validator.ts';
import type { BlenderProgram, Browser, FfmpegProgram, OperatingSystem, Program, ToolsManifest } from '../shared/contracts/tools.ts';
import { blenderVersion, describeUnsupportedBlender, findBlender, isSupportedBlenderVersion, sha256OfFile } from './blender.ts';
import { runBlenderProbe } from './blender-probe.ts';
import { readBrowserCapabilities } from './browser-capabilities.ts';
import type { BrowserToCheck, CapabilityCheck } from './browser-capabilities.ts';
import { browserVersion, findBrowsers } from './browsers.ts';
import { findFfmpeg, findFfprobe } from './ffmpeg.ts';
import { describeFfmpegGaps, ffmpegEncoders, ffmpegFilters, ffmpegVersion, missingEncoders, missingFilters } from './ffmpeg-info.ts';
import { detectGpu } from './gpu.ts';
import { isInteractiveSession, readLongPathsEnabled } from './session.ts';

/** The file name of the manifest under the data directory. */
export const toolsManifestFileName = 'tools.json';

/** The manifest's path for a data directory. */
export function toolsManifestPath(dataDir: string): string {
  return join(dataDir, toolsManifestFileName);
}

/** What buildToolsManifest needs from the command. */
export interface ManifestContext {
  readonly dataDir: string;
  readonly runner: ProcessRunner;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly now: () => Date;
}

/** Reads a browser's WebGL report; readBrowserCapabilities in production, injectable so tests need not launch a browser. */
export type CapabilityReader = (browser: BrowserToCheck, dataDir: string, log: Logger, signal: AbortSignal) => Promise<CapabilityCheck>;

/** Options doctor passes through from its flags; env, platform and the capability reader are injectable for tests. */
export interface ManifestOptions {
  readonly skipBrowserCheck: boolean;
  readonly skipBlenderProbe: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly readCapabilities?: CapabilityReader;
}

/** What the lane rules look at. */
export interface LaneInputs {
  readonly ffmpeg: FfmpegProgram | undefined;
  readonly ffprobe: Program | undefined;
  readonly browsers: readonly Browser[];
  /** Undefined when Blender was not found; otherwise whether its version is supported and whether the probe, when it ran, failed. */
  readonly blender: { readonly supported: boolean; readonly probeFailed: boolean } | undefined;
}

/** True when ffmpeg was found with every required filter and encoder. */
export function ffmpegComplete(ffmpeg: FfmpegProgram | undefined): boolean {
  return ffmpeg !== undefined && missingFilters(ffmpeg.filters).length === 0 && missingEncoders(ffmpeg.encoders).length === 0;
}

/**
 * The lane rules: html needs a browser, complete ffmpeg and ffprobe; three
 * needs html plus a browser that reported WebGL2; blender needs complete
 * ffmpeg and a supported Blender whose probe did not fail; audio needs
 * ffmpeg with the aac and pcm_s16le encoders.
 */
export function computeLanes(inputs: LaneInputs): ToolsManifest['lanes'] {
  const ffmpegOk = ffmpegComplete(inputs.ffmpeg);
  const html = inputs.browsers.length > 0 && ffmpegOk && inputs.ffprobe !== undefined;
  const three = html && inputs.browsers.some((browser) => browser.webgl?.webgl2 === true);
  const blender = ffmpegOk && inputs.blender !== undefined && inputs.blender.supported && !inputs.blender.probeFailed;
  const encoders = inputs.ffmpeg?.encoders ?? [];
  const audio = inputs.ffmpeg !== undefined && encoders.includes('aac') && encoders.includes('pcm_s16le');
  return { html, three, blender, audio };
}

/**
 * The narration component's state under the data directory (ADR 0007), read
 * from the disk alone the way `audio status` reads it: installed when the
 * two packages are under node_modules and npm's hidden lockfile says the
 * last npm ci finished; weightsVerified when, besides that, the copied
 * lockfile equals the template and every pinned weight exists at its exact
 * byte size (`audio install` verified the SHA-256 before the file reached
 * that path, and `audio install --verify` re-hashes on request).
 */
export function narrationState(dataDir: string): ToolsManifest['narration'] {
  const status = componentStatus(dataDir);
  return { installed: status.packagesPresent, weightsVerified: status.installed };
}

/** process.platform as the schema's OperatingSystem; anything else is recorded as linux. */
export function operatingSystem(platform: NodeJS.Platform): OperatingSystem {
  return platform === 'win32' || platform === 'darwin' ? platform : 'linux';
}

/** The sentence recorded when a browser renders WebGL in software. */
export function describeSoftwareRenderer(channel: Browser['channel'], renderer: string): string {
  return `${channel} renders WebGL with a software rasterizer (${renderer}); the three lane will be slow and EEVEE-like effects may differ.`;
}

/** The sentence recorded when a browser's WebGL check ran and failed; doctor's lane hint looks for its `WebGL check failed` fragment. */
export function describeFailedWebglCheck(channel: Browser['channel'], reason: string): string {
  return `${channel}: the WebGL check failed: ${reason}.`;
}

async function inspectFfmpeg(context: ManifestContext, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): Promise<{ readonly ffmpeg?: FfmpegProgram; readonly ffprobe?: Program; readonly problems: readonly string[] }> {
  const found = findFfmpeg(env, platform);
  const problems: string[] = [];
  let ffmpeg: FfmpegProgram | undefined;
  if (found !== undefined) {
    const version = await ffmpegVersion(context.runner, found.path, context.signal);
    if (version === undefined) {
      problems.push(`ffmpeg at ${found.path} did not report a version; it may be broken.`);
    } else {
      const filters = await ffmpegFilters(context.runner, found.path, context.signal);
      const encoders = await ffmpegEncoders(context.runner, found.path, context.signal);
      ffmpeg = { path: found.path, version, filters: [...filters], encoders: [...encoders] };
      problems.push(...describeFfmpegGaps(filters, encoders));
    }
  }
  const probeFound = findFfprobe(found?.path, env, platform);
  let ffprobe: Program | undefined;
  if (probeFound !== undefined) {
    const version = await ffmpegVersion(context.runner, probeFound.path, context.signal);
    if (version === undefined) problems.push(`ffprobe at ${probeFound.path} did not report a version; it may be broken.`);
    else ffprobe = { path: probeFound.path, version };
  }
  return { ...(ffmpeg === undefined ? {} : { ffmpeg }), ...(ffprobe === undefined ? {} : { ffprobe }), problems };
}

async function inspectBrowsers(context: ManifestContext, options: ManifestOptions, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): Promise<{ readonly browsers: readonly Browser[]; readonly problems: readonly string[] }> {
  const discovery = findBrowsers(env, platform);
  const problems = [...discovery.problems];
  const readCapabilities = options.readCapabilities ?? readBrowserCapabilities;
  const browsers: Browser[] = [];
  for (const found of discovery.found) {
    const version = await browserVersion(context.runner, found.path, env, platform, context.signal) ?? 'unknown';
    context.log.debug(`${found.channel} ${version} at ${found.path} (found by ${found.foundBy})`);
    const check: CapabilityCheck = options.skipBrowserCheck ? { report: null } : await readCapabilities(found, context.dataDir, context.log, context.signal);
    if (check.reason !== undefined) problems.push(describeFailedWebglCheck(found.channel, check.reason));
    else if (check.report !== null && !check.report.hardware) problems.push(describeSoftwareRenderer(found.channel, check.report.renderer));
    browsers.push({ channel: found.channel, path: found.path, version, webgl: check.report });
  }
  return { browsers, problems };
}

async function inspectBlender(context: ManifestContext, options: ManifestOptions, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): Promise<{ readonly blender?: BlenderProgram; readonly lane: LaneInputs['blender']; readonly problems: readonly string[] }> {
  const discovery = await findBlender(context.runner, env, platform, context.signal);
  const problems = [...discovery.problems];
  if (discovery.found === undefined) return { lane: undefined, problems };
  const path = discovery.found.path;
  context.log.debug(`Blender at ${path} (found by ${discovery.found.foundBy})`);
  const version = await blenderVersion(context.runner, path, context.signal);
  if (version === undefined) {
    problems.push(`Blender at ${path} did not report a version; it may be broken.`);
    return { lane: undefined, problems };
  }
  let sha256: string | undefined;
  try {
    sha256 = await sha256OfFile(path);
  } catch (error: unknown) {
    problems.push(`Blender at ${path} could not be hashed: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const found: BlenderProgram = { path, version, ...(sha256 === undefined ? {} : { sha256 }) };
  const supported = isSupportedBlenderVersion(version);
  if (!supported) {
    problems.push(describeUnsupportedBlender(version, path, platform));
    return { blender: found, lane: { supported, probeFailed: false }, problems };
  }
  if (options.skipBlenderProbe) return { blender: found, lane: { supported, probeFailed: false }, problems };
  const probe = await runBlenderProbe(context.runner, path, context.signal);
  if (!probe.ok) {
    problems.push(probe.problem);
    return { blender: found, lane: { supported, probeFailed: true }, problems };
  }
  if (probe.warning !== undefined) problems.push(probe.warning);
  return {
    blender: {
      ...found,
      python: probe.probe.python,
      engines: [...probe.probe.engines],
      computeDeviceTypes: [...probe.probe.computeDeviceTypes],
      devices: probe.probe.devices.map((device) => ({ name: device.name, type: device.type })),
      actionSlots: probe.probe.actionSlots,
      mediaType: probe.probe.mediaType,
    },
    lane: { supported, probeFailed: false },
    problems,
  };
}

/** Discovers everything and assembles the manifest. Nothing here throws for a missing or broken program; those become absent entries and problem sentences. */
export async function buildToolsManifest(context: ManifestContext, options: ManifestOptions): Promise<ToolsManifest> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const interactive = await isInteractiveSession(context.runner, env, platform, context.signal);
  const longPaths = await readLongPathsEnabled(context.runner, env, platform, context.signal);
  const ffmpeg = await inspectFfmpeg(context, env, platform);
  const browsers = await inspectBrowsers(context, options, env, platform);
  const gpu = await detectGpu(context.runner, env, platform, context.signal);
  const blender = await inspectBlender(context, options, env, platform);
  const problems: string[] = [...ffmpeg.problems, ...browsers.problems, ...blender.problems];
  if (!interactive) problems.push('This is not an interactive desktop session; headless browsers and EEVEE may not reach the GPU, and the Blender lane falls back to Cycles.');
  return {
    kind: 'tools',
    version: 1,
    generatedAt: context.now().toISOString(),
    platform: { os: operatingSystem(platform), arch: process.arch, release: release() },
    node: { path: process.execPath, version: process.version },
    interactiveSession: interactive,
    longPathsEnabled: longPaths,
    programs: {
      ...(ffmpeg.ffmpeg === undefined ? {} : { ffmpeg: ffmpeg.ffmpeg }),
      ...(ffmpeg.ffprobe === undefined ? {} : { ffprobe: ffmpeg.ffprobe }),
      ...(blender.blender === undefined ? {} : { blender: blender.blender }),
    },
    browsers: [...browsers.browsers],
    gpu,
    lanes: computeLanes({ ffmpeg: ffmpeg.ffmpeg, ffprobe: ffmpeg.ffprobe, browsers: browsers.browsers, blender: blender.lane }),
    narration: narrationState(context.dataDir),
    problems,
  };
}

/** Validates the manifest and writes it atomically as tools.json; returns the path. */
export function writeToolsManifest(dataDir: string, manifest: ToolsManifest): string {
  validateDocument('tools', manifest);
  const path = toolsManifestPath(dataDir);
  writeJsonAtomic(path, manifest);
  return path;
}

/** Reads and validates tools.json. A missing file says to run doctor; an invalid one names its problems. */
export function readToolsManifest(dataDir: string): ToolsManifest {
  const path = toolsManifestPath(dataDir);
  if (!existsSync(path)) throw new DataFileError(path, 'the file does not exist', 'Run doctor: node scripts/cli.ts doctor --data-dir <dir> writes it.');
  const document = readJsonFile(path);
  validateDocument('tools', document);
  return document as ToolsManifest;
}
