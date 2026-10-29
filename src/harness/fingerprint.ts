/**
 * The render manifest's fingerprint (ADR 0006 decision 5): everything that
 * influences pixels. The browser part comes from the open renderer, the
 * machine part from the Windows registry (the scaling and ClearType
 * settings text anti-aliasing reads), the rest from the tool versions.
 * Equal fingerprints on one machine mean byte-identical frames.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ToolMissingError } from '../errors/vision-forge-error.ts';
import { readJsonFile } from '../fs/atomic-json.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import type { RenderManifest } from '../shared/contracts/render-manifest.ts';
import { contentHash } from '../shared/sha256.ts';
import { parseDword, readRegistryValue } from '../tools/windows-registry.ts';
import { repositoryRoot } from './served-roots.ts';
import type { BrowserFingerprint } from './types.ts';

/** The fingerprint type the manifest contract declares. */
export type ManifestFingerprint = RenderManifest['fingerprint'];

/** The four ClearType registry values as decimal strings. */
export type ClearTypeValues = NonNullable<ManifestFingerprint['clearType']>;

/** What the machine contributes on Windows; both keys are absent elsewhere. */
export interface MachineFingerprint {
  /** AppliedDPI under HKCU\Control Panel\Desktop\WindowMetrics: 96 at 100 percent scaling. */
  readonly appliedDpi?: number;
  readonly clearType?: ClearTypeValues;
}

/** The registry key of the scaling value. */
export const windowMetricsKey = 'HKCU\\Control Panel\\Desktop\\WindowMetrics';

/** The registry key of the four ClearType values. */
export const desktopKey = 'HKCU\\Control Panel\\Desktop';

/** The ClearType value names under the desktop key, in the order the fingerprint lists them. */
export const clearTypeValueNames = { fontSmoothing: 'FontSmoothing', fontSmoothingType: 'FontSmoothingType', orientation: 'FontSmoothingOrientation', gamma: 'FontSmoothingGamma' } as const;

/** reg.exe prints a REG_DWORD as hex (0x78) and a REG_SZ as is ("2"); the fingerprint records both as decimal text. */
export function registryDecimalText(data: string): string {
  const dword = parseDword(data);
  return dword === undefined ? data.trim() : String(dword);
}

/**
 * Reads the machine part through reg.exe on Windows. A value that cannot be
 * read is left out rather than guessed; the four ClearType values are
 * recorded only when all four were read, because the contract records them
 * together.
 */
export async function readMachineFingerprint(runner: ProcessRunner, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, signal: AbortSignal = new AbortController().signal): Promise<MachineFingerprint> {
  if (platform !== 'win32') return {};
  const appliedDpi = parseDword(await readRegistryValue(runner, windowMetricsKey, 'AppliedDPI', env, platform, signal));
  const values: Partial<Record<keyof ClearTypeValues, string>> = {};
  for (const key of Object.keys(clearTypeValueNames) as (keyof ClearTypeValues)[]) {
    const data = await readRegistryValue(runner, desktopKey, clearTypeValueNames[key], env, platform, signal);
    if (data !== undefined) values[key] = registryDecimalText(data);
  }
  const { fontSmoothing, fontSmoothingType, orientation, gamma } = values;
  const clearType: ClearTypeValues | undefined = fontSmoothing !== undefined && fontSmoothingType !== undefined && orientation !== undefined && gamma !== undefined
    ? { fontSmoothing, fontSmoothingType, orientation, gamma }
    : undefined;
  return {
    ...(appliedDpi === undefined ? {} : { appliedDpi }),
    ...(clearType === undefined ? {} : { clearType }),
  };
}

/** The installed three version, read from node_modules/three/package.json. */
export function threeVersion(repoRoot: string = repositoryRoot): string {
  const packagePath = join(repoRoot, 'node_modules', 'three', 'package.json');
  // The same error the vendor root raises, so a missing three reads alike wherever it is noticed.
  const missing = new ToolMissingError('The three package (node_modules/three)', `Run "npm ci" in ${repoRoot} to install the pinned dependencies.`);
  if (!existsSync(packagePath)) throw missing;
  const parsed = readJsonFile(packagePath);
  const version = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['version'] : undefined;
  if (typeof version !== 'string' || version.length === 0) throw missing;
  return version;
}

/** The parts a fingerprint is built from. */
export interface FingerprintParts {
  readonly browser: BrowserFingerprint;
  readonly machine: MachineFingerprint;
  /** process.version, with its leading v. */
  readonly node: string;
  /** The three version; only the three lane records it. */
  readonly three?: string;
  /** The version ffmpeg reports. */
  readonly ffmpeg: string;
}

/** The manifest fingerprint of a browser render; optional keys are absent, not undefined, so the document validates. */
export function buildFingerprint(parts: FingerprintParts): ManifestFingerprint {
  return {
    browser: { channel: parts.browser.channel, version: parts.browser.version, args: [...parts.browser.args] },
    webglRenderer: parts.browser.webglRenderer,
    ...(parts.machine.appliedDpi === undefined ? {} : { appliedDpi: parts.machine.appliedDpi }),
    ...(parts.machine.clearType === undefined ? {} : { clearType: { ...parts.machine.clearType } }),
    node: parts.node,
    ...(parts.three === undefined ? {} : { three: parts.three }),
    ffmpeg: parts.ffmpeg,
  };
}

/** The manifest's toolVersionsHash: the content hash of the fingerprint. */
export function toolVersionsHash(fingerprint: ManifestFingerprint): Promise<string> {
  return contentHash(fingerprint);
}
