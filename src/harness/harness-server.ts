/**
 * Starts and stops the harness server (serve.ts) as a child process and
 * exposes its URL. The render command keeps one instance alive for a whole
 * render; tests start one per suite.
 *
 * The child is a long-running server, not a job with an exit code, so it is
 * spawned directly rather than through a ProcessRunner: standard input is
 * the lifeline (closing it stops the server), the first standard output
 * line carries the port, and standard error lines go to the debug log.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { Logger } from '../cli/logger.ts';
import { CancelledError, VisionForgeError } from '../errors/vision-forge-error.ts';
import { writeJsonAtomic } from '../fs/atomic-json.ts';
import type { ServeConfig } from './request-handler.ts';
import { assertServedRoot } from './static-roots.ts';
import type { ServedRoot } from './static-roots.ts';

/** How long the child may take to report its port. */
export const startTimeoutMs = 15_000;

/** How long stop() waits after closing the child's standard input before killing it. */
export const stopGraceMs = 2_000;

/** What a HarnessServer needs. Tests that must not spawn a process should not construct one. */
export interface HarnessServerOptions {
  /** The directories to serve; each is checked before anything is spawned. Relative directories resolve against the working directory. */
  readonly roots: readonly ServedRoot[];
  readonly log: Logger;
  /** A fixed port; 0 (the default) lets the operating system pick a free one. */
  readonly port?: number;
}

/** The harness server could not be started, was given something it cannot serve, or was used while not running. */
export class HarnessServerError extends VisionForgeError {
  constructor(message: string, hint: string, cause?: unknown) {
    super({ code: 'harness-server', message, hint, cause });
  }
}

const startHint = 'Run "node src/harness/serve.ts --config <file>" by hand to see the error, and check that nothing blocks loopback listeners.';

interface RunningChild {
  readonly child: ChildProcess;
  readonly port: number;
  readonly configDir: string;
  /** Settles when the child has exited and its pipes have closed. */
  readonly closed: Promise<void>;
  /** Stops reacting to the start signal. */
  readonly detach: () => void;
}

/** Calls onLine for every complete line of a text stream, and for a trailing partial line at its end. */
function forwardLines(stream: Readable, onLine: (line: string) => void): void {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      onLine(pending.slice(0, newline).replace(/\r$/, ''));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (pending.length > 0) onLine(pending);
  });
}

function parsePortLine(line: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new HarnessServerError(`The harness server printed "${line}" instead of its port.`, startHint);
  }
  const port = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['port'] : undefined;
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) {
    throw new HarnessServerError(`The harness server printed "${line}" instead of its port.`, startHint);
  }
  return port;
}

/** Resolves true when the promise settles within the limit, false otherwise. */
function settlesWithin(promise: Promise<void>, limitMs: number): Promise<boolean> {
  return new Promise<boolean>((done) => {
    const timer = setTimeout(() => done(false), limitMs);
    promise.then(() => { clearTimeout(timer); done(true); }, () => { clearTimeout(timer); done(true); });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The roots with their directories resolved, each checked so that a mistake fails here and not in the child. */
function checkedRoots(roots: readonly ServedRoot[]): ServedRoot[] {
  return roots.map((root, index) => {
    const resolved: ServedRoot = { urlPrefix: root.urlPrefix, directory: resolve(root.directory) };
    try {
      assertServedRoot(resolved, `roots[${index}]`);
    } catch (error: unknown) {
      if (error instanceof VisionForgeError) throw new HarnessServerError(error.message, error.hint, error);
      throw error;
    }
    return resolved;
  });
}

function checkedPort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new HarnessServerError(`The port ${String(port)} is not an integer from 0 to 65535.`, 'Pass port 0 (the default) to let the operating system pick a free one.');
  }
  return port;
}

/** The harness server as a child process: start it, read its URL, stop it. */
export class HarnessServer {
  private readonly roots: readonly ServedRoot[];
  private readonly log: Logger;
  private readonly port: number;
  private readonly servePath: string;
  private running: RunningChild | undefined;
  private stopping: Promise<void> | undefined;

  constructor(options: HarnessServerOptions) {
    this.roots = checkedRoots(options.roots);
    this.log = options.log;
    this.port = checkedPort(options.port ?? 0);
    this.servePath = join(import.meta.dirname, 'serve.ts');
    this.running = undefined;
    this.stopping = undefined;
  }

  /** The server's base URL, `http://127.0.0.1:<port>`. Throws before start() and after stop(). */
  get url(): string {
    if (this.running === undefined) {
      throw new HarnessServerError('The harness server is not running.', 'Call start() first and read url before stop().');
    }
    return `http://127.0.0.1:${this.running.port}`;
  }

  /**
   * Writes the config, spawns the child and resolves once it reports its
   * port. Aborting the signal stops the server, during start or later.
   */
  async start(signal: AbortSignal): Promise<void> {
    if (this.stopping !== undefined) await this.stopping;
    if (this.running !== undefined) throw new HarnessServerError('The harness server is already running.', 'Call stop() before starting it again.');
    if (signal.aborted) throw new CancelledError();
    const configDir = mkdtempSync(join(tmpdir(), 'vf-harness-'));
    const configPath = join(configDir, 'config.json');
    const config: ServeConfig = { roots: this.roots, port: this.port };
    writeJsonAtomic(configPath, config);

    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', this.servePath, '--config', configPath], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const recentStderr: string[] = [];
    forwardLines(child.stderr, (line) => {
      this.log.debug(`harness: ${line}`);
      recentStderr.push(line);
      if (recentStderr.length > 10) recentStderr.shift();
    });
    const closed = new Promise<void>((done) => { child.once('close', () => done()); });
    child.on('error', (error: Error) => { this.log.warn(`harness server: ${error.message}`); });

    let port: number;
    try {
      port = await this.waitForPort(child, child.stdout, signal, recentStderr);
    } catch (error: unknown) {
      child.kill();
      await settlesWithin(closed, stopGraceMs);
      this.removeConfigDir(configDir);
      throw error;
    }

    const onAbort = (): void => {
      void this.stop().catch((error: unknown) => { this.log.warn(`Could not stop the harness server: ${messageOf(error)}`); });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const running: RunningChild = { child, port, configDir, closed, detach: () => { signal.removeEventListener('abort', onAbort); } };
    this.running = running;
    void closed.then(() => {
      if (this.running !== running) return;
      this.running = undefined;
      running.detach();
      this.removeConfigDir(configDir);
      this.log.warn(`The harness server exited unexpectedly (exit code ${child.exitCode === null ? 'none' : String(child.exitCode)}).`);
    });
  }

  /**
   * Closes the child's standard input, waits briefly, kills it if needed,
   * and removes the config. A second call while one is in flight returns
   * the same promise; a call when nothing runs resolves at once.
   */
  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    const running = this.running;
    if (running === undefined) return Promise.resolve();
    this.running = undefined;
    running.detach();
    const stopping = this.stopChild(running).finally(() => {
      if (this.stopping === stopping) this.stopping = undefined;
    });
    this.stopping = stopping;
    return stopping;
  }

  private async stopChild(running: RunningChild): Promise<void> {
    const { child } = running;
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin?.end();
      if (!(await settlesWithin(running.closed, stopGraceMs))) {
        this.log.debug('harness: still running after standard input closed; killing it.');
        child.kill();
        if (!(await settlesWithin(running.closed, stopGraceMs))) child.kill('SIGKILL');
        await running.closed;
      }
    }
    this.removeConfigDir(running.configDir);
  }

  /** Removes the config directory; a failure (an indexer holding the file, say) is a warning, never a crash. */
  private removeConfigDir(dir: string): void {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (error: unknown) {
      this.log.warn(`Could not remove ${dir}: ${messageOf(error)}`);
    }
  }

  private waitForPort(child: ChildProcess, stdout: Readable, signal: AbortSignal, recentStderr: readonly string[]): Promise<number> {
    return new Promise<number>((resolvePromise, rejectPromise) => {
      let settled = false;
      const settle = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        outcome();
      };
      const onAbort = (): void => { settle(() => rejectPromise(new CancelledError())); };
      const timer = setTimeout(() => {
        settle(() => rejectPromise(new HarnessServerError(`The harness server did not report its port within ${startTimeoutMs / 1000} s.`, startHint)));
      }, startTimeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      forwardLines(stdout, (line) => {
        if (settled) {
          this.log.debug(`harness: ${line}`);
          return;
        }
        settle(() => {
          try {
            resolvePromise(parsePortLine(line));
          } catch (error: unknown) {
            rejectPromise(error);
          }
        });
      });
      child.once('error', (error: Error) => {
        settle(() => rejectPromise(new HarnessServerError(`Could not start the harness server: ${error.message}`, startHint, error)));
      });
      child.once('exit', (code: number | null) => {
        const tail = recentStderr.length > 0 ? ` Last output: ${recentStderr.join(' | ')}` : '';
        settle(() => rejectPromise(new HarnessServerError(`The harness server exited with code ${code === null ? 'none' : String(code)} before reporting its port.${tail}`, startHint)));
      });
    });
  }
}
