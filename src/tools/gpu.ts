/**
 * Identifies the graphics adapter and its driver: nvidia-smi when it is on
 * PATH, otherwise the first Win32_VideoController through PowerShell on
 * Windows. Other platforms without nvidia-smi report null; the browser's
 * WebGL renderer string says what actually renders.
 */
import type { ProcessRunner } from '../process/process-runner.ts';
import { findOnPath } from './find-program.ts';

/** The adapter doctor records. */
export interface GpuInfo {
  readonly name: string;
  readonly driver: string;
}

/** The first line of `nvidia-smi --query-gpu=name,driver_version --format=csv,noheader`: "NVIDIA GeForce RTX 2060, 610.88". */
export function parseNvidiaSmi(stdout: string): GpuInfo | undefined {
  const line = stdout.split(/\r?\n/).map((text) => text.trim()).find((text) => text.length > 0);
  if (line === undefined) return undefined;
  const separator = line.lastIndexOf(',');
  if (separator < 0) return undefined;
  const name = line.slice(0, separator).trim();
  const driver = line.slice(separator + 1).trim();
  return name.length > 0 && driver.length > 0 ? { name, driver } : undefined;
}

/** The PowerShell command that prints the first video controller as `<name>|<driver>`. */
export const videoControllerCommand = "$v = Get-CimInstance Win32_VideoController | Select-Object -First 1; if ($null -ne $v) { Write-Output ($v.Name + '|' + $v.DriverVersion) }";

/** The `<name>|<driver>` line the PowerShell query prints. */
export function parseVideoController(stdout: string): GpuInfo | undefined {
  const line = stdout.split(/\r?\n/).map((text) => text.trim()).find((text) => text.length > 0);
  if (line === undefined) return undefined;
  const separator = line.indexOf('|');
  if (separator < 0) return undefined;
  const name = line.slice(0, separator).trim();
  const driver = line.slice(separator + 1).trim();
  return name.length > 0 ? { name, driver } : undefined;
}

/** The adapter, or null when none could be identified. */
export async function detectGpu(runner: ProcessRunner, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, signal: AbortSignal = new AbortController().signal): Promise<GpuInfo | null> {
  const nvidiaSmi = findOnPath('nvidia-smi', env, platform);
  if (nvidiaSmi !== undefined) {
    const result = await runner.run({ label: 'nvidia-smi', executable: nvidiaSmi, args: ['--query-gpu=name,driver_version', '--format=csv,noheader'], timeoutMs: 15_000 }, signal);
    const parsed = result.exitCode === 0 ? parseNvidiaSmi(result.stdout) : undefined;
    if (parsed !== undefined) return parsed;
  }
  if (platform === 'win32') {
    const powershell = findOnPath('powershell', env, platform);
    if (powershell === undefined) return null;
    const result = await runner.run({ label: 'powershell', executable: powershell, args: ['-NoProfile', '-NonInteractive', '-Command', videoControllerCommand], timeoutMs: 30_000 }, signal);
    const parsed = result.exitCode === 0 ? parseVideoController(result.stdout) : undefined;
    return parsed ?? null;
  }
  return null;
}
