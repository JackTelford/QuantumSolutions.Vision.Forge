/**
 * Shared helpers for the M0 probes. Node only.
 *
 * Every probe writes a markdown evidence file under docs/evidence/m0/ with the
 * exact commands it ran, the raw numbers it measured and an explicit
 * "Not verified" section. The helpers here keep that format identical.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root (two levels above this file). */
export const repoRoot: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where probe evidence markdown files are written. */
export const evidenceDir: string = join(repoRoot, 'docs', 'evidence', 'm0');

/** Short scratch root for probe output (ignored by git, kept short for MAX_PATH). */
export const scratchDir: string = join(repoRoot, '.tmp');

/** Result of one external process run. */
export interface CommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

/** Options for runCommand. */
export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly stdin?: Buffer;
}

/** Result of one external process run with stdout kept as bytes. */
export interface BinaryCommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly elapsedMs: number;
}

/**
 * Runs an executable with an argument array and no shell, capturing output.
 * The executable must be a real program path (never a .cmd or .bat file).
 */
export async function runCommand(executable: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
  const raw = await runCommandBuffer(executable, args, options);
  return { exitCode: raw.exitCode, signal: raw.signal, stdout: raw.stdout.toString('utf8'), stderr: raw.stderr, elapsedMs: raw.elapsedMs };
}

/** Same as runCommand, but stdout is returned as a Buffer (for raw pixel data). */
export function runCommandBuffer(executable: string, args: readonly string[], options: CommandOptions = {}): Promise<BinaryCommandResult> {
  return new Promise<BinaryCommandResult>((resolvePromise, rejectPromise) => {
    const started = process.hrtime.bigint();
    const child = spawn(executable, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => child.kill(), options.timeoutMs);
    }
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (error: Error) => {
      if (timer !== undefined) clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (timer !== undefined) clearTimeout(timer);
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      resolvePromise({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        elapsedMs,
      });
    });
    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

/** SHA-256 of a file, lowercase hex. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** SHA-256 of a string, lowercase hex. */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Finds an executable on PATH, honoring PATHEXT on Windows. Returns undefined when absent. */
export function findOnPath(name: string): string | undefined {
  const pathValue = process.env['PATH'] ?? process.env['Path'] ?? '';
  const extensions = process.platform === 'win32'
    ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
    : [''];
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Absolute ffmpeg path: FFMPEG env override, else PATH lookup. Throws when missing. */
export function ffmpegPath(): string {
  return requireTool('ffmpeg', process.env['FFMPEG']);
}

/** Absolute ffprobe path: derived from FFMPEG env override, else PATH lookup. Throws when missing. */
export function ffprobePath(): string {
  const override = process.env['FFMPEG'];
  if (override !== undefined && override.length > 0) {
    const sibling = join(dirname(override), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (existsSync(sibling)) return sibling;
  }
  return requireTool('ffprobe', undefined);
}

function requireTool(name: string, override: string | undefined): string {
  if (override !== undefined && override.length > 0 && existsSync(override)) return override;
  const found = findOnPath(name);
  if (found === undefined) {
    throw new Error(`${name} was not found on PATH. Install it or set the ${name.toUpperCase()} environment variable.`);
  }
  // On Windows, PATH lookups must resolve to a real .exe, never a .cmd shim.
  if (process.platform === 'win32' && !found.toLowerCase().endsWith('.exe')) {
    throw new Error(`${name} resolved to ${found}, which is not an .exe. Point the ${name.toUpperCase()} environment variable at the real executable.`);
  }
  return found;
}

/** Candidate install locations of Microsoft Edge on Windows, first existing wins. */
export function edgePath(): string | undefined {
  if (process.platform !== 'win32') return findOnPath('microsoft-edge');
  const roots = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles'], process.env['LOCALAPPDATA']];
  for (const root of roots) {
    if (root === undefined) continue;
    const candidate = join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Candidate install locations of Google Chrome on Windows, first existing wins. */
export function chromePath(): string | undefined {
  if (process.platform !== 'win32') return findOnPath('google-chrome') ?? findOnPath('chrome');
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']];
  for (const root of roots) {
    if (root === undefined) continue;
    const candidate = join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Reads a file's version resource on Windows through PowerShell; returns "unknown" elsewhere. */
export async function windowsFileVersion(path: string): Promise<string> {
  if (process.platform !== 'win32') return 'unknown';
  const powershell = findOnPath('powershell');
  if (powershell === undefined) return 'unknown';
  const result = await runCommand(powershell, [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Item -LiteralPath '${path.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
  ], { timeoutMs: 30_000 });
  return result.stdout.trim() || 'unknown';
}

/** Reads one registry value through reg.exe on Windows; returns undefined when absent or not on Windows. */
export async function registryValue(key: string, valueName: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  const reg = findOnPath('reg');
  if (reg === undefined) return undefined;
  const result = await runCommand(reg, ['query', key, '/v', valueName], { timeoutMs: 15_000 });
  if (result.exitCode !== 0) return undefined;
  const line = result.stdout.split(/\r?\n/).find((l) => l.trim().startsWith(valueName));
  if (line === undefined) return undefined;
  const parts = line.trim().split(/\s{2,}/);
  return parts[parts.length - 1];
}

/** Machine facts that influence rendering: OS, Node, GPU driver, DPI and ClearType settings. */
export async function machineFingerprint(): Promise<Record<string, string>> {
  const facts: Record<string, string> = {
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    v8: process.versions.v8 ?? 'unknown',
    cpuCount: String((await import('node:os')).cpus().length),
    timestamp: new Date().toISOString(),
  };
  const nvidiaSmi = findOnPath('nvidia-smi');
  if (nvidiaSmi !== undefined) {
    const result = await runCommand(nvidiaSmi, ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], { timeoutMs: 15_000 });
    facts['gpu'] = result.stdout.trim() || 'unknown';
  }
  const desktop = 'HKCU\\Control Panel\\Desktop';
  const appliedDpi = await registryValue(`${desktop}\\WindowMetrics`, 'AppliedDPI');
  if (appliedDpi !== undefined) facts['appliedDpi'] = appliedDpi;
  for (const name of ['FontSmoothing', 'FontSmoothingType', 'FontSmoothingOrientation', 'FontSmoothingGamma']) {
    const value = await registryValue(desktop, name);
    if (value !== undefined) facts[name] = value;
  }
  const longPaths = await registryValue('HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'LongPathsEnabled');
  if (longPaths !== undefined) facts['longPathsEnabled'] = longPaths;
  return facts;
}

/**
 * Quotes a file path for use inside an ffmpeg filter option (for example
 * `lut3d=file=...` or `drawtext=fontfile=...`). ffmpeg parses a filtergraph at
 * two levels: single quotes protect the value from the graph parser (`,` `;`
 * `[` `]`), and `\:` protects the colon from the option parser. Backslashes
 * become forward slashes, which Windows accepts. An apostrophe in the path
 * closes and reopens the quotes with an escaped quote in between.
 */
export function filterPath(path: string): string {
  const forward = path.replace(/\\/g, '/').replace(/:/g, '\\:');
  return `'${forward.replace(/'/g, "'\\''")}'`;
}

/** Pixel hash of an image or video stream via ffmpeg's framehash muxer (SHA-256 of decoded pixels, not file bytes). */
export async function framehash(mediaPath: string): Promise<string> {
  const result = await runCommand(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', mediaPath, '-f', 'framehash', '-hash', 'sha256', '-'], { timeoutMs: 60_000 });
  if (result.exitCode !== 0) throw new Error(`ffmpeg framehash failed for ${mediaPath}: ${result.stderr.trim()}`);
  const line = result.stdout.split(/\r?\n/).find((l) => l.length > 0 && !l.startsWith('#'));
  if (line === undefined) throw new Error(`ffmpeg framehash produced no hash line for ${mediaPath}`);
  const fields = line.trim().split(/,\s*/);
  return fields[fields.length - 1] ?? '';
}

/** SSIM and PSNR between two images of equal size, measured by ffmpeg. */
export async function compareImages(pathA: string, pathB: string): Promise<{ readonly ssim: number; readonly psnr: number }> {
  const result = await runCommand(ffmpegPath(), [
    '-hide_banner', '-loglevel', 'info', '-i', pathA, '-i', pathB,
    '-lavfi', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim=f=-;[0:v]format=gbrp[c];[1:v]format=gbrp[d];[c][d]psnr',
    '-f', 'null', '-',
  ], { timeoutMs: 60_000 });
  const text = result.stderr;
  const ssimMatch = /SSIM .*All:([0-9.]+)/.exec(text);
  const psnrMatch = /PSNR .*average:([0-9.]+|inf)/.exec(text);
  const psnrText = psnrMatch?.[1] ?? 'NaN';
  return {
    ssim: Number.parseFloat(ssimMatch?.[1] ?? 'NaN'),
    psnr: psnrText === 'inf' ? Number.POSITIVE_INFINITY : Number.parseFloat(psnrText),
  };
}

/** Kills processes whose command line contains the given fragment (Windows only; used to clean up browser profiles we launched). */
export async function killProcessesMentioning(fragment: string): Promise<number> {
  if (process.platform !== 'win32') return 0;
  const powershell = findOnPath('powershell');
  if (powershell === undefined) return 0;
  const escaped = fragment.replace(/'/g, "''");
  const script = `$n=0; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; Write-Output $n`;
  const result = await runCommand(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 60_000 });
  return Number.parseInt(result.stdout.trim(), 10) || 0;
}

/** Creates a directory tree if needed and returns it. */
export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/** Formats milliseconds with one decimal. */
export function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

/** Accumulates a markdown evidence report and writes it to docs/evidence/m0/<name>.md. */
export class EvidenceReport {
  private readonly lines: string[] = [];
  private readonly notVerified: string[] = [];
  private readonly name: string;

  constructor(name: string, title: string) {
    this.name = name;
    this.lines.push(`# ${title}`, '', `Generated ${new Date().toISOString()} by \`node scripts/probes/run.ts ${name}\`.`, '');
  }

  /** Adds a level-2 heading. */
  heading(text: string): void {
    this.lines.push(`## ${text}`, '');
  }

  /** Adds a paragraph. */
  paragraph(text: string): void {
    this.lines.push(text, '');
  }

  /** Adds a fenced code block. */
  code(language: string, text: string): void {
    this.lines.push('```' + language, text.replace(/\s+$/, ''), '```', '');
  }

  /** Adds a markdown table. */
  table(headers: readonly string[], rows: readonly (readonly string[])[]): void {
    this.lines.push(`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of rows) this.lines.push(`| ${row.map((cell) => cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`);
    this.lines.push('');
  }

  /** Adds a key/value table from a record. */
  facts(record: Record<string, string>): void {
    this.table(['Fact', 'Value'], Object.entries(record).map(([k, v]) => [k, v]));
  }

  /** Records something this probe could not establish. */
  unverified(text: string): void {
    this.notVerified.push(text);
  }

  /** Writes the report and returns its path. */
  write(): string {
    ensureDir(evidenceDir);
    const path = join(evidenceDir, `${this.name}.md`);
    const tail = ['## Not verified', '', ...(this.notVerified.length === 0 ? ['Nothing left unverified by this probe.'] : this.notVerified.map((t) => `- ${t}`)), ''];
    writeFileSync(path, [...this.lines, ...tail].join('\n'), { encoding: 'utf8' });
    return path;
  }
}
