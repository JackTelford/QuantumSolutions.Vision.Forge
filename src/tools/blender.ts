/**
 * Finds Blender the way ADR 0004 documents it and gates its version to the
 * 5.2 LTS series. Discovery on Windows: the BLENDER override, the machine
 * and per-user install folders, the `blender.5.2` ProgID command in the
 * registry (with the launcher swapped for blender.exe) and finally PATH;
 * Microsoft Store builds under WindowsApps are refused because they expose
 * only a launcher alias. The version comes from `blender --version`.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, win32 } from 'node:path';
import type { ProcessRunner } from '../process/process-runner.ts';
import { findOnPath, isRunnableFile } from './find-program.ts';
import { readRegistryValue } from './windows-registry.ts';

/** Environment variable that overrides Blender discovery; it must point at the real executable. */
export const blenderEnvironmentVariable = 'BLENDER';

/** The only supported major.minor series (ADR 0004). */
export const supportedBlenderSeries = '5.2';

/** The exact version the setup scripts install. */
export const blenderInstallVersion = '5.2.3';

/**
 * The install command per platform, printed verbatim by doctor and the setup
 * scripts. The blender snap publishes only latest/stable and latest/edge
 * (snapcraft.io, checked 2026-10-26), so Linux cannot pin a 5.2 track and
 * the user confirms the version afterwards.
 */
export const blenderInstallCommand: Readonly<Record<string, string>> = {
  win32: `winget install --id BlenderFoundation.Blender --version ${blenderInstallVersion} --exact`,
  darwin: 'brew install --cask blender',
  linux: `sudo snap install blender --classic (then confirm blender --version starts with ${supportedBlenderSeries})`,
};

/** The install command for a platform. */
export function blenderCommand(platform: NodeJS.Platform = process.platform): string {
  return blenderInstallCommand[platform] ?? blenderInstallCommand['linux'] ?? '';
}

/** The hint doctor prints when Blender is absent. */
export function blenderInstallHint(platform: NodeJS.Platform = process.platform): string {
  return `Install Blender ${supportedBlenderSeries} LTS with: ${blenderCommand(platform)} (then open a new terminal), or set ${blenderEnvironmentVariable} to the full path of the blender executable. The html and three lanes work without it.`;
}

/** The sentence doctor records when an installed Blender is not 5.2.x. */
export function describeUnsupportedBlender(version: string, path: string, platform: NodeJS.Platform = process.platform): string {
  return `Blender ${version} at ${path} is not supported; only ${supportedBlenderSeries}.x is. Install ${blenderInstallVersion} with: ${blenderCommand(platform)} (two versions can coexist).`;
}

/** How Blender was found. */
export type BlenderFoundBy = 'env' | 'known-folder' | 'registry' | 'path';

/** Where Blender was found. */
export interface FoundBlender {
  readonly path: string;
  readonly foundBy: BlenderFoundBy;
}

/** The outcome of discovery: the program when one was accepted, plus sentences about candidates that were refused. */
export interface BlenderDiscovery {
  readonly found: FoundBlender | undefined;
  readonly problems: readonly string[];
}

/** True for a path under a WindowsApps folder: a Microsoft Store build, which exposes only a launcher alias. */
export function isWindowsAppsPath(path: string): boolean {
  return /[\\/]WindowsApps[\\/]/i.test(path);
}

/** The install folders tried, in order, per platform. */
export function knownBlenderPaths(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): readonly string[] {
  if (platform === 'win32') {
    const folder = join('Blender Foundation', `Blender ${supportedBlenderSeries}`, 'blender.exe');
    const candidates: string[] = [];
    const programFiles = env['ProgramFiles'];
    if (programFiles !== undefined && programFiles.length > 0) candidates.push(join(programFiles, folder));
    const local = env['LOCALAPPDATA'];
    if (local !== undefined && local.length > 0) candidates.push(join(local, 'Programs', folder));
    return candidates;
  }
  if (platform === 'darwin') return ['/Applications/Blender.app/Contents/MacOS/Blender'];
  return ['/snap/bin/blender', '/usr/bin/blender', '/usr/local/bin/blender'];
}

/** The executable path inside a registry `shell\open\command` value such as `"C:\Blender\blender-launcher.exe" "%1"`. */
export function parseRegistryCommand(data: string | undefined): string | undefined {
  if (data === undefined) return undefined;
  const match = /^\s*"?([^"]*?\.exe)(?:"|\s|$)/i.exec(data);
  return match?.[1];
}

/**
 * The same path with `blender-launcher.exe` replaced by `blender.exe` (the
 * launcher starts Blender in a new console, so its output cannot be
 * captured). The input is always a Windows path, so the file name is taken
 * with the win32 rules whatever the host, and the result keeps the original
 * separators by slicing instead of joining.
 */
export function launcherToBlender(path: string): string {
  const name = win32.basename(path);
  return /^blender-launcher\.exe$/i.test(name) ? `${path.slice(0, path.length - name.length)}blender.exe` : path;
}

/** The registry keys that hold the Blender 5.2 ProgID command, machine first. */
export const blenderRegistryKeys: readonly string[] = [
  `HKLM\\SOFTWARE\\Classes\\blender.${supportedBlenderSeries}\\shell\\open\\command`,
  `HKCU\\SOFTWARE\\Classes\\blender.${supportedBlenderSeries}\\shell\\open\\command`,
];

/** Accepts a candidate path, or explains why it was refused. */
function consider(path: string, foundBy: BlenderFoundBy, problems: string[], description: string): FoundBlender | undefined {
  if (isWindowsAppsPath(path)) {
    problems.push(`Blender at ${path} (${description}) is a Microsoft Store build, which is not supported; install it with winget or from blender.org.`);
    return undefined;
  }
  return isRunnableFile(path) ? { path, foundBy } : undefined;
}

/**
 * Finds Blender: BLENDER, the known folders, the registry ProgID command
 * (Windows), then PATH. A refused candidate (a Store build, an override that
 * is not a runnable file) is reported as a problem; discovery continues past
 * a refused folder or registry entry but stops at a refused override.
 */
export async function findBlender(runner: ProcessRunner, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, signal: AbortSignal = new AbortController().signal): Promise<BlenderDiscovery> {
  const problems: string[] = [];
  const override = env[blenderEnvironmentVariable];
  if (override !== undefined && override.length > 0) {
    const found = consider(override, 'env', problems, `from ${blenderEnvironmentVariable}`);
    if (found === undefined && !isWindowsAppsPath(override)) problems.push(`${blenderEnvironmentVariable} is set to ${override}, which is not a runnable file; point it at the blender executable or unset it.`);
    return { found, problems };
  }
  for (const candidate of knownBlenderPaths(env, platform)) {
    const found = consider(candidate, 'known-folder', problems, 'install folder');
    if (found !== undefined) return { found, problems };
  }
  if (platform === 'win32') {
    for (const key of blenderRegistryKeys) {
      const command = parseRegistryCommand(await readRegistryValue(runner, key, undefined, env, platform, signal));
      if (command === undefined) continue;
      const found = consider(launcherToBlender(command), 'registry', problems, `from the registry key ${key}`);
      if (found !== undefined) return { found, problems };
    }
  }
  const onPath = findOnPath('blender', env, platform);
  if (onPath !== undefined) {
    const found = consider(onPath, 'path', problems, 'on PATH');
    if (found !== undefined) return { found, problems };
  }
  return { found: undefined, problems };
}

/** The version in the first `blender --version` line: "Blender 5.2.3 LTS" gives "5.2.3". */
export function parseBlenderVersion(text: string): string | undefined {
  return /^\s*Blender\s+(\d+\.\d+\.\d+)/m.exec(text)?.[1];
}

/** True when the version is in the supported series (major.minor equals 5.2). */
export function isSupportedBlenderVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version);
  return match !== null && `${match[1]}.${match[2]}` === supportedBlenderSeries;
}

/** Runs `blender --version` and returns the version, or undefined when it does not run or prints nothing recognizable. */
export async function blenderVersion(runner: ProcessRunner, executable: string, signal: AbortSignal = new AbortController().signal): Promise<string | undefined> {
  const result = await runner.run({ label: 'blender', executable, args: ['--version'], timeoutMs: 60_000 }, signal);
  if (result.exitCode !== 0 || result.timedOut) return undefined;
  return parseBlenderVersion(`${result.stdout}\n${result.stderr}`);
}

/** SHA-256 of a file as lowercase hex, streamed so a 300 MB executable is not read into memory at once. */
export function sha256OfFile(path: string): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => { hash.update(chunk); });
    stream.on('error', rejectPromise);
    stream.on('end', () => { resolvePromise(hash.digest('hex')); });
  });
}
