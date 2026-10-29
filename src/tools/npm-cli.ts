/**
 * Where npm's own entry script lives beside the running Node, so the
 * narration installer can run `npm ci` by spawning node.exe with
 * npm-cli.js (ADR 0007): never `npm.cmd` (spawnSync of a .cmd fails with
 * EINVAL on Node 24 without a shell, and a shell is a rule violation). On
 * Windows npm ships inside the Node folder; on macOS and Linux under
 * `<prefix>/lib/node_modules`, where the prefix is the parent of `bin`.
 */
import { posix, win32 } from 'node:path';

/** The candidate paths of npm-cli.js for a Node executable, most likely first; the caller takes the first that exists. */
export function npmCliCandidates(execPath: string, platform: NodeJS.Platform = process.platform): readonly string[] {
  // The path functions of the platform asked for, not the host's, so a Windows path reads the same in a test on a Linux runner.
  const path = platform === 'win32' ? win32 : posix;
  const binDir = path.dirname(execPath);
  if (platform === 'win32') return [path.join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const prefix = path.dirname(binDir);
  return [path.join(prefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')];
}

/** The arguments that install a component's lockfile exactly, without scripts: `npm ci --ignore-scripts --no-audit --no-fund`. */
export function npmCiArguments(npmCliPath: string): readonly string[] {
  return [npmCliPath, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'];
}
