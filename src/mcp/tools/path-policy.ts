/**
 * Where a tool may read and write (ADR 0009 decision 7): the output
 * directory, the data directory, the repository (for the shipped examples)
 * and the user's home directory. A relative path resolves against the output
 * directory, since the client's working directory is not the user's; a path
 * that lands anywhere else is refused with the directories to use.
 *
 * The comparison is lexical: `..` segments are resolved, but a symbolic link
 * or junction under an allowed root is not followed, so one that points
 * elsewhere passes. That is accepted: the home directory is an allowed root
 * anyway, and the policy bounds what a model reaches by name on a machine it
 * already runs on as the user (decision 7), not the user. Tightening would
 * realpath the nearest existing ancestor before the root check.
 */
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ExitCodes, VisionForgeError } from '../../errors/vision-forge-error.ts';
import type { ServerPaths } from '../types.ts';

/** The error code a refused path carries. */
export const pathNotAllowedCode = 'path-not-allowed';

/** The directories a tool may reach, resolved: output, data, repository, home. */
export function allowedRoots(paths: ServerPaths, home: string = homedir()): readonly string[] {
  return [paths.outDir, paths.dataDir, paths.repositoryRoot, home].map((root) => resolve(root));
}

/** True when the resolved path is the root or lies under it; Windows compares without case. */
export function isUnderRoot(path: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
  const fold = (value: string): string => (platform === 'win32' ? value.toLowerCase() : value);
  const between = relative(fold(resolve(root)), fold(resolve(path)));
  return between === '' || (!between.startsWith(`..${sep}`) && between !== '..' && !isAbsolute(between));
}

/**
 * The absolute path an input names, resolved against the output directory,
 * when it lies under one of the allowed roots; otherwise a usage-style error
 * with code path-not-allowed whose hint names the roots. `purpose` says what
 * the path is for in the message ("the job folder").
 */
export function resolveAllowedPath(input: string, paths: ServerPaths, purpose: string, home: string = homedir()): string {
  if (input.trim().length === 0) {
    throw new VisionForgeError({ code: pathNotAllowedCode, message: `The path for ${purpose} is empty.`, hint: `Pass ${purpose} as an absolute path or one relative to ${resolve(paths.outDir)}.`, exitCode: ExitCodes.usage });
  }
  const resolved = resolve(paths.outDir, input);
  const roots = allowedRoots(paths, home);
  if (roots.some((root) => isUnderRoot(resolved, root))) return resolved;
  throw new VisionForgeError({
    code: pathNotAllowedCode,
    message: `The path for ${purpose}, ${input}, resolves to ${resolved}, outside the directories this server may touch.`,
    hint: `Use a path under one of: ${roots.join(', ')}. A relative path resolves against the output directory, ${roots[0] ?? ''}.`,
    exitCode: ExitCodes.usage,
  });
}
