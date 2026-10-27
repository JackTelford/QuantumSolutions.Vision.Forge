/**
 * Facts about the session doctor runs in: whether it is an interactive
 * desktop session (a headless browser and EEVEE need one to reach the GPU)
 * and whether Windows has long paths enabled.
 */
import type { ProcessRunner } from '../process/process-runner.ts';
import { findOnPath } from './find-program.ts';
import { parseDword, readRegistryValue } from './windows-registry.ts';

/** The PowerShell expression that prints True in an interactive desktop session: user-interactive and not session 0 (services). */
export const interactiveSessionCommand = '[Environment]::UserInteractive -and ((Get-Process -Id $PID).SessionId -ne 0)';

/** The registry key and value that hold the Windows long-paths policy. */
export const longPathsKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem';
/** The value name under longPathsKey. */
export const longPathsValueName = 'LongPathsEnabled';

/** PowerShell's `True`/`False` as a boolean; undefined for anything else. */
export function parsePowershellBoolean(stdout: string): boolean | undefined {
  const text = stdout.trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return undefined;
}

/**
 * True in an interactive desktop session. Windows asks PowerShell; macOS
 * always has a window server for the logged-in user; Linux needs DISPLAY or
 * WAYLAND_DISPLAY. When PowerShell is absent or answers nothing usable the
 * session is assumed interactive, so a missing tool never becomes a problem.
 */
export async function isInteractiveSession(runner: ProcessRunner, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, signal: AbortSignal = new AbortController().signal): Promise<boolean> {
  if (platform === 'darwin') return true;
  if (platform !== 'win32') {
    const display = env['DISPLAY'];
    const wayland = env['WAYLAND_DISPLAY'];
    return (display !== undefined && display.length > 0) || (wayland !== undefined && wayland.length > 0);
  }
  const powershell = findOnPath('powershell', env, platform);
  if (powershell === undefined) return true;
  const result = await runner.run({ label: 'powershell', executable: powershell, args: ['-NoProfile', '-NonInteractive', '-Command', interactiveSessionCommand], timeoutMs: 30_000 }, signal);
  return result.exitCode === 0 ? parsePowershellBoolean(result.stdout) ?? true : true;
}

/** The Windows LongPathsEnabled policy as a boolean; null on other platforms or when it could not be read. */
export async function readLongPathsEnabled(runner: ProcessRunner, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, signal: AbortSignal = new AbortController().signal): Promise<boolean | null> {
  if (platform !== 'win32') return null;
  const value = parseDword(await readRegistryValue(runner, longPathsKey, longPathsValueName, env, platform, signal));
  return value === undefined ? null : value !== 0;
}
