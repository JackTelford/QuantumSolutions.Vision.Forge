/**
 * `version`: the repository version from package.json and the Node version.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';

/** Shape of the version payload. */
export interface VersionData {
  readonly name: string;
  readonly version: string;
  readonly node: string;
  readonly platform: string;
}

/** Reads name and version from the repository's package.json. */
export function readPackageVersion(): { readonly name: string; readonly version: string } {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
  const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { readonly name?: unknown; readonly version?: unknown };
  return {
    name: typeof parsed.name === 'string' ? parsed.name : 'vision-forge',
    version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
  };
}

/** The version command. */
export const command: Command = {
  name: 'version',
  summary: 'Print the repository version, the Node version and the platform.',
  options: { strings: [], flags: [] },
  run(_context: CommandContext, _args: ParsedArguments): Promise<CommandOutput> {
    const pkg = readPackageVersion();
    const data: VersionData = { name: pkg.name, version: pkg.version, node: process.version, platform: `${process.platform}-${process.arch}` };
    return Promise.resolve({ data });
  },
};
