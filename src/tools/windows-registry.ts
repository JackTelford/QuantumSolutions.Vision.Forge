/**
 * Reads single registry values through reg.exe, the way the M0 probes did.
 * doctor reads the Blender ProgID command and the long-paths policy, and
 * the render fingerprint (src/harness/fingerprint.ts) reads the DPI and
 * ClearType values; everything else is discovered through the file system.
 *
 * Known limitation: reg.exe writes in the console's OEM code page and the
 * runner decodes UTF-8, so data with non-ASCII characters (a Blender
 * registered under C:\Users\Müller\...) comes back mangled and the path it
 * names is not found. Such an install is still found through the known
 * folders, PATH or the BLENDER override.
 */
import { join } from 'node:path';
import type { ProcessRunner } from '../process/process-runner.ts';
import { findOnPath, isRunnableFile } from './find-program.ts';

/** One value as `reg query` prints it: `    LongPathsEnabled    REG_DWORD    0x0`. */
export interface RegistryValue {
  readonly name: string;
  readonly type: string;
  readonly data: string;
}

/** The reg.exe to use: PATH first, then %SystemRoot%\System32; undefined off Windows or when absent. */
export function findRegExe(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== 'win32') return undefined;
  const onPath = findOnPath('reg', env, platform);
  if (onPath !== undefined) return onPath;
  const systemRoot = env['SystemRoot'] ?? env['SYSTEMROOT'] ?? 'C:\\Windows';
  const candidate = join(systemRoot, 'System32', 'reg.exe');
  return isRunnableFile(candidate) ? candidate : undefined;
}

/** Every value line in `reg query` output. Columns are separated by runs of at least two spaces; the data may itself contain single spaces. */
export function parseRegistryValues(stdout: string): readonly RegistryValue[] {
  const values: RegistryValue[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*?)\s*$/.exec(line) ?? /^\s+(.+?)\s{2,}(REG_[A-Z_]+)\s*$/.exec(line);
    if (match === null) continue;
    values.push({ name: match[1] ?? '', type: match[2] ?? '', data: match[3] ?? '' });
  }
  return values;
}

/**
 * The data of one value under a key: the named value (`/v <name>`, matched
 * by name case-insensitively), or the key's default value (`/ve`) when no
 * name is given. The default value is the one value line `/ve` prints and
 * is taken by position, because reg.exe localizes its label (`(Default)`,
 * `(Standard)`, `(Predeterminado)`). Undefined when reg.exe is absent, the
 * key or value does not exist, or the query fails.
 */
export async function readRegistryValue(runner: ProcessRunner, key: string, valueName: string | undefined, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, signal: AbortSignal = new AbortController().signal): Promise<string | undefined> {
  const reg = findRegExe(env, platform);
  if (reg === undefined) return undefined;
  const args = valueName === undefined ? ['query', key, '/ve'] : ['query', key, '/v', valueName];
  const result = await runner.run({ label: 'reg', executable: reg, args, timeoutMs: 15_000 }, signal);
  if (result.exitCode !== 0 || result.timedOut) return undefined;
  const values = parseRegistryValues(result.stdout);
  if (valueName === undefined) return values[0]?.data;
  const wanted = valueName.toLowerCase();
  return values.find((value) => value.name.toLowerCase() === wanted)?.data;
}

/** A REG_DWORD's data (`0x1`) as a number, or undefined when it is not hexadecimal. */
export function parseDword(data: string | undefined): number | undefined {
  if (data === undefined) return undefined;
  const match = /^0x([0-9a-f]+)$/i.exec(data.trim());
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 16);
}
