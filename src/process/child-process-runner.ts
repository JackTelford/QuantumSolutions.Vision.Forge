/**
 * ProcessRunner backed by child_process.spawn: argument arrays, no shell,
 * absolute executable paths, output captured in memory and optionally to
 * files, a time limit and cancellation.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import { CancelledError, InvalidExecutableError } from '../errors/vision-forge-error.ts';
import type { ProcessResult, ProcessRunner, ProcessSpec } from './process-runner.ts';

const forbiddenExtensions: readonly string[] = ['.cmd', '.bat', '.ps1'];

/** Throws unless the path is an absolute path to an existing file that is not a shell script. */
export function assertRunnableExecutable(path: string): void {
  if (!isAbsolute(path)) throw new InvalidExecutableError(path, 'the path is not absolute');
  if (forbiddenExtensions.includes(extname(path).toLowerCase())) throw new InvalidExecutableError(path, 'shell scripts cannot be spawned without a shell');
  if (!existsSync(path) || !statSync(path).isFile()) throw new InvalidExecutableError(path, 'the file does not exist');
}

/** The production ProcessRunner. */
export class ChildProcessRunner implements ProcessRunner {
  /** Spawns the program and resolves when it exits. Rejects only on cancellation or a bad executable. */
  run(spec: ProcessSpec, signal: AbortSignal): Promise<ProcessResult> {
    assertRunnableExecutable(spec.executable);
    if (signal.aborted) return Promise.reject(new CancelledError());
    return new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
      const started = process.hrtime.bigint();
      const child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd ?? process.cwd(),
        env: spec.env === undefined ? process.env : { ...process.env, ...spec.env },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const stdoutFile = spec.stdoutFile === undefined ? undefined : createWriteStream(spec.stdoutFile);
      const stderrFile = spec.stderrFile === undefined ? undefined : createWriteStream(spec.stderrFile);
      let timedOut = false;
      let cancelled = false;
      const timer = spec.timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; child.kill(); }, spec.timeoutMs);
      const onAbort = (): void => { cancelled = true; child.kill(); };
      signal.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk); stdoutFile?.write(chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); stderrFile?.write(chunk); });
      child.on('error', (error: Error) => {
        cleanup();
        rejectPromise(new InvalidExecutableError(spec.executable, error.message));
      });
      child.on('close', (exitCode: number | null, exitSignal: string | null) => {
        cleanup();
        if (cancelled) {
          rejectPromise(new CancelledError());
          return;
        }
        resolvePromise({
          exitCode,
          signal: exitSignal,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
          timedOut,
        });
      });

      function cleanup(): void {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        stdoutFile?.end();
        stderrFile?.end();
      }

      if (spec.stdin !== undefined) {
        child.stdin.end(spec.stdin);
      } else {
        child.stdin.end();
      }
    });
  }
}
