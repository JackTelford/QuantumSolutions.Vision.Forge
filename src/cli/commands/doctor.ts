/**
 * `doctor`: finds Node, ffmpeg, ffprobe, the browsers, the GPU and Blender,
 * checks what each offers, writes tools.json under the data directory and
 * says which lanes can run. Exit 1 when a required program is missing or a
 * lane named in --require is unavailable; a missing Blender is a warning.
 */
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';
import { ToolMissingError, UsageError } from '../../errors/vision-forge-error.ts';
import type { ToolsManifest } from '../../shared/contracts/tools.ts';
import { blenderInstallHint, describeUnsupportedBlender, isSupportedBlenderVersion, supportedBlenderSeries } from '../../tools/blender.ts';
import { browserHint } from '../../tools/browsers.ts';
import { ffmpegHint } from '../../tools/ffmpeg.ts';
import { missingOptionalEncoders } from '../../tools/ffmpeg-info.ts';
import { buildToolsManifest, ffmpegComplete, writeToolsManifest } from '../../tools/tools-manifest.ts';

/** The lowest Node version the repository runs on (package.json engines). */
export const minimumNodeVersion = { major: 24, minor: 12 } as const;

/** Install hints for Node per platform. */
const nodeInstallHint: Readonly<Record<string, string>> = {
  win32: 'Install Node.js 24 with: winget install --id OpenJS.NodeJS.LTS --exact (then open a new terminal).',
  darwin: 'Install Node.js 24 with: brew install node@24.',
  linux: 'Install Node.js 24 from https://nodejs.org/ (NodeSource packages or nvm).',
};

/** The lane names --require accepts. */
export const laneNames: readonly (keyof ToolsManifest['lanes'])[] = ['html', 'three', 'blender', 'audio'];

/** One program doctor could not find, with the way to install it. */
export interface MissingTool {
  readonly tool: string;
  readonly hint: string;
  /** False for Blender, whose absence only disables its lane. */
  readonly required: boolean;
}

/** Shape of the doctor payload: the manifest plus what is missing and where it was written. */
export type DoctorData = ToolsManifest & {
  readonly missing: readonly MissingTool[];
  readonly manifestPath: string;
};

/** True when a Node version string (v24.13.0) meets the minimum. */
export function nodeMeetsMinimum(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\./.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > minimumNodeVersion.major || (major === minimumNodeVersion.major && minor >= minimumNodeVersion.minor);
}

/** The lanes named in a comma-separated --require value; an unknown name is a usage error. */
export function parseRequiredLanes(value: string | undefined): readonly (keyof ToolsManifest['lanes'])[] {
  if (value === undefined) return [];
  const names = value.split(',').map((name) => name.trim()).filter((name) => name.length > 0);
  for (const name of names) {
    if (!laneNames.includes(name as keyof ToolsManifest['lanes'])) throw new UsageError(`Unknown lane "${name}" in --require.`, `Lanes: ${laneNames.join(', ')}.`);
  }
  return names as (keyof ToolsManifest['lanes'])[];
}

/** The programs that are missing, required ones first. */
export function findMissing(manifest: ToolsManifest, platform: NodeJS.Platform): readonly MissingTool[] {
  const missing: MissingTool[] = [];
  if (!nodeMeetsMinimum(manifest.node.version)) missing.push({ tool: `Node.js ${minimumNodeVersion.major}.${minimumNodeVersion.minor} or newer`, hint: nodeInstallHint[platform] ?? nodeInstallHint['linux'] ?? '', required: true });
  if (manifest.programs.ffmpeg === undefined) missing.push({ tool: 'ffmpeg', hint: ffmpegHint(platform), required: true });
  if (manifest.programs.ffprobe === undefined) missing.push({ tool: 'ffprobe', hint: ffmpegHint(platform), required: true });
  if (manifest.browsers.length === 0) missing.push({ tool: 'a browser (Microsoft Edge or Google Chrome)', hint: browserHint(platform), required: true });
  if (manifest.programs.blender === undefined) missing.push({ tool: `Blender ${supportedBlenderSeries} LTS`, hint: blenderInstallHint(platform), required: false });
  return missing;
}

/** Why the three lane has no WebGL2 browser: the recorded check failure, the WebGL1-only verdict, or the skipped check. */
function webglHint(manifest: ToolsManifest, problems: readonly string[]): string {
  const failed = problems.find((text) => text.includes('WebGL check failed'));
  if (failed !== undefined) return failed;
  const checked = manifest.browsers.some((browser) => browser.webgl !== null && browser.webgl !== undefined);
  return checked ? 'Every browser reported WebGL without WebGL2; update the GPU driver or the browser.' : 'Run doctor without --skip-browser-check so the WebGL report is recorded.';
}

/** Why a lane is unavailable, as the thing it needs and the hint to get it; undefined when the lane can run. */
export function laneGap(manifest: ToolsManifest, lane: keyof ToolsManifest['lanes'], platform: NodeJS.Platform): { readonly what: string; readonly hint: string } | undefined {
  if (manifest.lanes[lane]) return undefined;
  const ffmpegProblem = manifest.programs.ffmpeg === undefined ? 'ffmpeg' : ffmpegComplete(manifest.programs.ffmpeg) ? undefined : 'ffmpeg with the required filters and encoders';
  const problems = manifest.problems;
  switch (lane) {
    case 'html':
      if (ffmpegProblem !== undefined) return { what: ffmpegProblem, hint: ffmpegHint(platform) };
      if (manifest.programs.ffprobe === undefined) return { what: 'ffprobe', hint: ffmpegHint(platform) };
      return { what: 'a browser (Microsoft Edge or Google Chrome)', hint: browserHint(platform) };
    case 'three': {
      const htmlGap = laneGap(manifest, 'html', platform);
      if (htmlGap !== undefined) return htmlGap;
      return { what: 'a browser with a WebGL2 context', hint: webglHint(manifest, problems) };
    }
    case 'blender': {
      if (ffmpegProblem !== undefined) return { what: ffmpegProblem, hint: ffmpegHint(platform) };
      const blender = manifest.programs.blender;
      if (blender === undefined) return { what: `Blender ${supportedBlenderSeries} LTS`, hint: blenderInstallHint(platform) };
      if (!isSupportedBlenderVersion(blender.version)) return { what: `Blender ${supportedBlenderSeries} LTS (found ${blender.version})`, hint: describeUnsupportedBlender(blender.version, blender.path, platform) };
      return { what: 'a Blender whose Python probe succeeds', hint: problems.find((text) => text.includes('Blender probe')) ?? 'Run doctor with --verbose to see the probe output.' };
    }
    case 'audio':
      return { what: 'ffmpeg with the aac and pcm_s16le encoders', hint: ffmpegHint(platform) };
    default:
      return { what: `the ${String(lane)} lane`, hint: 'See docs/SETUP.md.' };
  }
}

/** The one-line-per-tool report doctor logs. */
export function describeManifest(manifest: ToolsManifest, platform: NodeJS.Platform): readonly string[] {
  const lines: string[] = [];
  lines.push(`node ${manifest.node.version} at ${manifest.node.path}`);
  const ffmpeg = manifest.programs.ffmpeg;
  lines.push(ffmpeg === undefined ? `ffmpeg: not found. ${ffmpegHint(platform)}` : `ffmpeg ${ffmpeg.version} at ${ffmpeg.path}`);
  if (ffmpeg !== undefined) {
    const optional = missingOptionalEncoders(ffmpeg.encoders);
    if (optional.length > 0) lines.push(`ffmpeg: optional encoders not offered: ${optional.join(', ')} (HEVC, ProRes or Opus deliverables need them)`);
  }
  const ffprobe = manifest.programs.ffprobe;
  lines.push(ffprobe === undefined ? `ffprobe: not found. ${ffmpegHint(platform)}` : `ffprobe ${ffprobe.version} at ${ffprobe.path}`);
  if (manifest.browsers.length === 0) lines.push(`browser: not found. ${browserHint(platform)}`);
  for (const browser of manifest.browsers) {
    const webgl = browser.webgl;
    const report = webgl === null || webgl === undefined ? 'no WebGL report: the check was skipped or failed, see the problems' : `${webgl.webgl2 ? 'WebGL2' : 'WebGL1'} ${webgl.hardware ? 'hardware' : 'software'}: ${webgl.renderer}`;
    lines.push(`${browser.channel} ${browser.version} at ${browser.path} (${report})`);
  }
  const blender = manifest.programs.blender;
  if (blender === undefined) {
    lines.push(`Blender: not found. ${blenderInstallHint(platform)}`);
  } else {
    const probe = blender.engines === undefined ? 'probe skipped or failed' : `engines ${blender.engines.join(', ')}; devices ${(blender.devices ?? []).map((device) => `${device.name} (${device.type})`).join(', ') || 'none'}`;
    lines.push(`Blender ${blender.version} at ${blender.path} (${probe})`);
  }
  lines.push(manifest.gpu === null ? 'GPU: not identified' : `GPU: ${manifest.gpu.name}, driver ${manifest.gpu.driver}`);
  lines.push(`session: ${manifest.interactiveSession ? 'interactive' : 'not interactive'}; long paths: ${manifest.longPathsEnabled === null ? 'unknown' : manifest.longPathsEnabled ? 'enabled' : 'not enabled'}`);
  lines.push(`narration: ${manifest.narration.installed ? `installed, weights ${manifest.narration.weightsVerified ? 'verified' : 'not verified'}` : 'not installed'}`);
  lines.push(`lanes: ${laneNames.map((lane) => `${lane} ${manifest.lanes[lane] ? 'yes' : 'no'}`).join(', ')}`);
  return lines;
}

/** The doctor command. */
export const command: Command = {
  name: 'doctor',
  summary: 'Find ffmpeg, a browser, the GPU and Blender; write tools.json; report which lanes can run.',
  options: { strings: ['require'], flags: ['skip-browser-check', 'skip-blender-probe'] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const required = parseRequiredLanes(args.string('require'));
    const platform = process.platform;
    const manifest = await buildToolsManifest(context, { skipBrowserCheck: args.flag('skip-browser-check'), skipBlenderProbe: args.flag('skip-blender-probe') });
    const manifestPath = writeToolsManifest(context.dataDir, manifest);
    for (const line of describeManifest(manifest, platform)) context.log.info(line);
    for (const problem of manifest.problems) context.log.warn(problem);
    context.log.info(`wrote ${manifestPath}`);

    const missing = findMissing(manifest, platform);
    const fatal = missing.find((entry) => entry.required);
    if (fatal !== undefined) throw new ToolMissingError(fatal.tool, fatal.hint);
    for (const lane of required) {
      const gap = laneGap(manifest, lane, platform);
      if (gap !== undefined) throw new ToolMissingError(`${gap.what}, which the ${lane} lane needs,`, gap.hint);
    }
    const data: DoctorData = { ...manifest, missing, manifestPath };
    return { data };
  },
};
