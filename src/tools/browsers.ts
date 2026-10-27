/**
 * Finds the system browsers the html and three lanes can drive: Microsoft
 * Edge and Google Chrome, in that preference order. Discovery looks at the
 * CHROME override (Chrome only), the known install folders on Windows and
 * macOS, and the usual PATH names on Linux. The version is read from the
 * executable's version resource through PowerShell on Windows and from
 * `--version` elsewhere.
 */
import { join } from 'node:path';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { Channel } from '../shared/contracts/tools.ts';
import { findOnPath, isRunnableFile } from './find-program.ts';
import type { FoundProgram } from './find-program.ts';

/** Environment variable that overrides Chrome discovery; it must point at the real executable. */
export const chromeEnvironmentVariable = 'CHROME';

/** A browser that was found, before its version is read. */
export interface FoundBrowser extends FoundProgram {
  readonly channel: Channel;
}

/** The outcome of looking for one channel: the browser when one was accepted, plus sentences about a refused override. */
export interface ChannelDiscovery {
  readonly found: FoundBrowser | undefined;
  readonly problems: readonly string[];
}

/** The outcome of looking for every channel: the browsers found, Edge first, plus sentences about a refused override. */
export interface BrowserDiscovery {
  readonly found: readonly FoundBrowser[];
  readonly problems: readonly string[];
}

/** Install hints per platform, printed by doctor when no browser was found. */
export const browserInstallHint: Readonly<Record<string, string>> = {
  win32: 'Microsoft Edge ships with Windows 11; repair it from Settings > Apps, or install Google Chrome from https://www.google.com/chrome/ and set CHROME to the full path of chrome.exe if it is somewhere unusual.',
  darwin: 'Install Google Chrome (https://www.google.com/chrome/) or Microsoft Edge into /Applications, or set CHROME to the full path of the Chrome executable.',
  linux: 'Install google-chrome, microsoft-edge or chromium with your package manager so it is on PATH, or set CHROME to the full path of the executable.',
};

/** The browser install hint for the current platform. */
export function browserHint(platform: NodeJS.Platform = process.platform): string {
  return browserInstallHint[platform] ?? browserInstallHint['linux'] ?? '';
}

/** PATH names tried on Linux, in order, per channel. */
const linuxNames: Readonly<Record<Channel, readonly string[]>> = {
  msedge: ['microsoft-edge', 'microsoft-edge-stable'],
  chrome: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
};

/** The folders a channel is installed in on Windows and macOS, in the order they are tried. */
export function knownBrowserPaths(channel: Channel, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): readonly string[] {
  if (platform === 'win32') {
    const relative = channel === 'msedge' ? join('Microsoft', 'Edge', 'Application', 'msedge.exe') : join('Google', 'Chrome', 'Application', 'chrome.exe');
    const roots = channel === 'msedge'
      ? [env['ProgramFiles(x86)'], env['ProgramFiles'], env['LOCALAPPDATA']]
      : [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']];
    return roots.filter((root): root is string => root !== undefined && root.length > 0).map((root) => join(root, relative));
  }
  if (platform === 'darwin') {
    return channel === 'msedge'
      ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  return [];
}

/**
 * Finds one channel: the CHROME override for Chrome, then the known folders,
 * then (on Linux) the PATH names. A CHROME value that is not a runnable file
 * stops discovery of Chrome and is reported as a problem, like BLENDER.
 */
export function findBrowser(channel: Channel, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): ChannelDiscovery {
  if (channel === 'chrome') {
    const override = env[chromeEnvironmentVariable];
    if (override !== undefined && override.length > 0) {
      if (isRunnableFile(override)) return { found: { channel, path: override, foundBy: 'env' }, problems: [] };
      return { found: undefined, problems: [`${chromeEnvironmentVariable} is set to ${override}, which is not a runnable file; point it at the Chrome executable (chrome.exe on Windows) or unset it.`] };
    }
  }
  for (const candidate of knownBrowserPaths(channel, env, platform)) {
    if (isRunnableFile(candidate)) return { found: { channel, path: candidate, foundBy: 'known-folder' }, problems: [] };
  }
  if (platform === 'linux') {
    for (const name of linuxNames[channel]) {
      const onPath = findOnPath(name, env, platform);
      if (onPath !== undefined) return { found: { channel, path: onPath, foundBy: 'path' }, problems: [] };
    }
  }
  return { found: undefined, problems: [] };
}

/** Every browser that was found, Edge first, then Chrome, with the problems either channel reported. */
export function findBrowsers(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): BrowserDiscovery {
  const found: FoundBrowser[] = [];
  const problems: string[] = [];
  for (const channel of ['msedge', 'chrome'] as const) {
    const discovery = findBrowser(channel, env, platform);
    if (discovery.found !== undefined) found.push(discovery.found);
    problems.push(...discovery.problems);
  }
  return { found, problems };
}

/** The first four-part dotted version in a text ("Microsoft Edge 156.0.4314.42" gives "156.0.4314.42"), or undefined. */
export function parseBrowserVersion(text: string): string | undefined {
  return /(\d+\.\d+\.\d+\.\d+)/.exec(text)?.[1];
}

/** Quotes a path for a single-quoted PowerShell string literal. */
export function powershellLiteral(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

/**
 * Reads a browser's version: on Windows the executable's ProductVersion
 * through powershell.exe (the browser itself prints nothing useful), elsewhere
 * `<path> --version`. Undefined when neither works.
 */
export async function browserVersion(runner: ProcessRunner, path: string, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, signal: AbortSignal = new AbortController().signal): Promise<string | undefined> {
  if (platform === 'win32') {
    const powershell = findOnPath('powershell', env, platform);
    if (powershell === undefined) return undefined;
    const result = await runner.run({
      label: 'powershell',
      executable: powershell,
      args: ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath ${powershellLiteral(path)}).VersionInfo.ProductVersion`],
      timeoutMs: 30_000,
    }, signal);
    return result.exitCode === 0 ? parseBrowserVersion(result.stdout) : undefined;
  }
  const result = await runner.run({ label: 'browser', executable: path, args: ['--version'], timeoutMs: 30_000 }, signal);
  return result.exitCode === 0 ? parseBrowserVersion(result.stdout) : undefined;
}
