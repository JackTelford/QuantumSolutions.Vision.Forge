/**
 * The one place this repository talks to the network. Every download goes to
 * a `.download` partial next to its destination, resumes with a Range header
 * when a partial exists, is streamed to disk, and is renamed into place only
 * after its size and checksums match. Every redirect hop is checked against
 * the allowlist before it is fetched and logged at debug level. A watchdog
 * aborts a request that sends nothing (no headers, then no body chunk) for
 * the idle time. No other file under src/ may call fetch.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../cli/logger.ts';
import { CancelledError, DownloadIntegrityError, VisionForgeError } from '../errors/vision-forge-error.ts';
import { assertUrlAllowed } from './allowlist.ts';
import type { AllowedHost } from './allowlist.ts';

/** The fields every request has. A request also carries at least one digest (see DownloadRequest). */
interface DownloadRequestBase {
  readonly url: string;
  /** Final path; bytes are staged in `<destination>.download` until verified. */
  readonly destination: string;
  readonly expectedBytes?: number;
  /** Short name for logs and errors. */
  readonly label: string;
}

/**
 * What to download, where to put it and what it must hash to. At least one
 * digest is required: a hex SHA-256, a hex MD5 (Poly Haven publishes one) or
 * both. Nothing reaches its destination unverified.
 */
export type DownloadRequest = DownloadRequestBase & (
  | { readonly sha256: string; readonly md5?: string }
  | { readonly md5: string; readonly sha256?: string }
);

/** One request made while following redirects. The URL is recorded without its query string. */
export interface DownloadHop {
  readonly url: string;
  readonly status: number;
}

/** What a finished download looked like, for the asset ledger. */
export interface DownloadResult {
  readonly url: string;
  /** The URL that served the bytes, without its query string (signed CDN URLs change on every download). */
  readonly finalUrl: string;
  readonly hops: readonly DownloadHop[];
  readonly bytes: number;
  readonly sha256: string;
  readonly md5?: string;
  /** Bytes of an earlier partial that were kept; 0 when the download started from the beginning. */
  readonly resumedFrom: number;
  /** ISO 8601 time the download finished. */
  readonly fetchedAt: string;
}

/** How an HttpDownloader is configured. */
export interface HttpDownloaderOptions {
  readonly allowlist: readonly AllowedHost[];
  /** Sent on every request; Poly Haven requires a unique one. */
  readonly userAgent: string;
  readonly log: Logger;
  /** The most requests one download may make, counting the first. Default 5. */
  readonly maxHops?: number;
  /** A request is aborted when its headers, or the next body chunk, take longer than this. Default 30 000 (30 s). */
  readonly idleTimeoutMs?: number;
  /** The clock for fetchedAt; injected so tests are repeatable. */
  readonly now?: () => Date;
}

interface Digests {
  readonly sha256: string;
  readonly md5?: string;
}

interface OpenResponse {
  readonly response: Response;
  readonly hops: readonly DownloadHop[];
  readonly finalUrl: string;
}

const redirectStatuses: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const networkHint = 'Check the network connection and run the command again.';
const diskHint = 'Check free space and permissions on the destination directory.';

/** The partial file a download is staged in. */
export function partialPath(destination: string): string {
  return `${destination}.download`;
}

/** Downloads files from allowlisted hosts with resume and checksum verification. */
export class HttpDownloader {
  private readonly allowlist: readonly AllowedHost[];
  private readonly userAgent: string;
  private readonly log: Logger;
  private readonly maxHops: number;
  private readonly idleTimeoutMs: number;
  private readonly now: () => Date;

  constructor(options: HttpDownloaderOptions) {
    this.allowlist = options.allowlist;
    this.userAgent = options.userAgent;
    this.log = options.log;
    this.maxHops = options.maxHops ?? 5;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
    this.now = options.now ?? ((): Date => new Date());
  }

  /** Downloads one file, resuming a partial when one exists, and verifies it before it reaches `destination`. */
  async download(request: DownloadRequest, signal: AbortSignal): Promise<DownloadResult> {
    if (signal.aborted) throw new CancelledError();
    const partial = partialPath(request.destination);
    mkdirSync(dirname(request.destination), { recursive: true });
    if (request.expectedBytes !== undefined && existsSync(partial) && statSync(partial).size === request.expectedBytes) {
      this.log.debug(`${request.label}: a complete partial exists; verifying it without downloading`);
      return this.finish(request, partial, [], request.url, request.expectedBytes);
    }
    const existing = usablePartialBytes(partial, request.expectedBytes);
    const watchdog = new IdleWatchdog(signal, this.idleTimeoutMs);
    const opened = await this.open(request, existing, watchdog);
    const resumedFrom = await resumeOffset(opened, existing, request, partial);
    if (existing > 0 && resumedFrom === 0) this.log.debug(`${request.label}: the server ignored the Range header; starting over`);
    const declared = declaredTotalBytes(opened.response);
    if (declared !== undefined && request.expectedBytes !== undefined && declared !== request.expectedBytes) {
      await discardBody(opened.response);
      throw integrityFailure(request, partial, 'size', String(request.expectedBytes), String(declared));
    }
    await writeBody(opened, partial, resumedFrom > 0, request, watchdog);
    const bytes = statSync(partial).size;
    if (declared !== undefined && bytes !== declared) throw interrupted(request, opened.finalUrl, `received ${bytes} of ${declared} bytes`, undefined);
    return this.finish(request, partial, opened.hops, opened.finalUrl, resumedFrom);
  }

  /** Verifies the partial, renames it into place and builds the result the ledger records. */
  private async finish(request: DownloadRequest, partial: string, hops: readonly DownloadHop[], finalUrl: string, resumedFrom: number): Promise<DownloadResult> {
    const bytes = statSync(partial).size;
    const digests = await verify(request, partial, bytes);
    renameSync(partial, request.destination);
    this.log.debug(`${request.label}: ${bytes} bytes verified, sha256 ${digests.sha256}`);
    return { url: request.url, finalUrl, hops, bytes, ...digests, resumedFrom, fetchedAt: this.now().toISOString() };
  }

  /** Follows redirects manually, checking every hop, until a 200 or 206 arrives. */
  private async open(request: DownloadRequest, existing: number, watchdog: IdleWatchdog): Promise<OpenResponse> {
    const hops: DownloadHop[] = [];
    const originHost = new URL(request.url).hostname;
    let current = new URL(request.url);
    for (;;) {
      assertUrlAllowed(current, this.allowlist, hops.length === 0 ? undefined : originHost);
      const shown = withoutQuery(current);
      if (hops.length >= this.maxHops) {
        throw failed(request, shown, `more than ${this.maxHops} requests through redirects`, 'The source now redirects through more hops than allowed; review the pinned URL.', undefined);
      }
      const response = await this.fetchOnce(request, current, shown, existing, watchdog);
      hops.push({ url: shown, status: response.status });
      this.log.debug(`${request.label}: ${response.status} ${shown}`);
      if (response.status === 200 || (response.status === 206 && existing > 0)) return { response, hops, finalUrl: shown };
      await discardBody(response);
      if (redirectStatuses.has(response.status)) {
        const location = response.headers.get('location');
        if (location === null) throw failed(request, shown, `a ${response.status} redirect without a Location header`, 'The source is misbehaving; try again later.', undefined);
        current = new URL(location, current);
        continue;
      }
      if (response.status === 416) {
        rmSync(partialPath(request.destination), { force: true });
        throw failed(request, shown, 'the partial file was longer than the file on the server', 'The partial file was removed. Run the command again.', undefined);
      }
      const hint = response.status === 404 ? 'The pinned URL no longer exists; the pin must be reviewed.' : 'Run the command again later; if it keeps failing, the source may be down.';
      throw failed(request, shown, `the server answered ${response.status}`, hint, undefined);
    }
  }

  /** One GET of the full URL with the User-Agent, identity encoding and, when resuming, a Range header; `shown` is the URL for messages. */
  private async fetchOnce(request: DownloadRequest, url: URL, shown: string, existing: number, watchdog: IdleWatchdog): Promise<Response> {
    const headers: Record<string, string> = { 'user-agent': this.userAgent, 'accept-encoding': 'identity', ...(existing > 0 ? { range: `bytes=${existing}-` } : {}) };
    try {
      return await watchdog.watch(fetch(url, { method: 'GET', headers, redirect: 'manual', signal: watchdog.signal }));
    } catch (error: unknown) {
      if (watchdog.cancelled) throw new CancelledError();
      if (watchdog.timedOut) throw failed(request, shown, `no response within ${watchdog.idleSeconds} s`, networkHint, error);
      throw failed(request, shown, messageOf(error), networkHint, error);
    }
  }
}

/**
 * Aborts the request when the caller cancels or when one step (the response
 * headers, then each body chunk) takes longer than the idle time, and tells
 * the two apart afterwards. One watchdog covers every hop of one download.
 */
class IdleWatchdog {
  /** The signal handed to fetch: the caller's signal or the idle abort, whichever fires first. */
  readonly signal: AbortSignal;
  /** The idle time in seconds, for messages. */
  readonly idleSeconds: number;
  private readonly cancel: AbortSignal;
  private readonly idle = new AbortController();
  private readonly idleMs: number;

  constructor(cancel: AbortSignal, idleMs: number) {
    this.cancel = cancel;
    this.idleMs = idleMs;
    this.idleSeconds = idleMs / 1000;
    this.signal = AbortSignal.any([cancel, this.idle.signal]);
  }

  /** Waits for one step; aborts the request if the step has not settled within the idle time. */
  async watch<T>(step: Promise<T>): Promise<T> {
    const timer = setTimeout(() => { this.idle.abort(); }, this.idleMs);
    try {
      return await step;
    } finally {
      clearTimeout(timer);
    }
  }

  /** True once the caller cancelled. */
  get cancelled(): boolean {
    return this.cancel.aborted;
  }

  /** True once the idle timer fired. */
  get timedOut(): boolean {
    return this.idle.signal.aborted;
  }
}

/** The URL without its query string, for hops, logs and messages (signed CDN URLs carry secrets and change every time). */
function withoutQuery(url: URL): string {
  const shown = new URL(url.href);
  shown.search = '';
  return shown.href;
}

/** Size of a usable partial file: 0 when there is none, or when it is empty or longer than the expected file. */
function usablePartialBytes(partial: string, expectedBytes: number | undefined): number {
  if (!existsSync(partial)) return 0;
  const size = statSync(partial).size;
  if (size === 0 || (expectedBytes !== undefined && size >= expectedBytes)) {
    rmSync(partial, { force: true });
    return 0;
  }
  return size;
}

/** The byte offset the response continues from: `existing` for a matching 206, 0 for a 200 that ignored the Range header. */
async function resumeOffset(opened: OpenResponse, existing: number, request: DownloadRequest, partial: string): Promise<number> {
  if (opened.response.status !== 206) return 0;
  const start = contentRange(opened.response)?.start;
  if (start === existing) return existing;
  await discardBody(opened.response);
  rmSync(partial, { force: true });
  throw failed(request, opened.finalUrl, `the server resumed at byte ${start ?? 'unknown'} instead of ${existing}`, 'The partial file was removed. Run the command again to download from the beginning.', undefined);
}

/**
 * Streams the body into the partial file, appending when resuming. Each chunk is on disk before the next is
 * read, so an interruption leaves a correct prefix to resume from (stream.pipeline would discard queued chunks).
 * A failure on the file side is reported as download-failed with a disk hint; one on the network side as
 * download-interrupted, which resumes on the next run.
 */
async function writeBody(opened: OpenResponse, partial: string, append: boolean, request: DownloadRequest, watchdog: IdleWatchdog): Promise<void> {
  const body = opened.response.body;
  if (body === null) throw failed(request, opened.finalUrl, 'the response had no body', 'Run the command again.', undefined);
  const sink = createWriteStream(partial, { flags: append ? 'a' : 'w' });
  let sinkError: unknown;
  let writeError: unknown;
  sink.on('error', (error: Error) => { sinkError = error; });
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await watchdog.watch(reader.read());
      if (done) break;
      writeError = await writeChunk(sink, value);
      if (writeError !== undefined) throw writeError;
    }
    sink.end();
    await whenClosed(sink);
    if (sinkError !== undefined) throw sinkError;
  } catch (error: unknown) {
    sink.destroy();
    await whenClosed(sink);
    await reader.cancel().catch((): void => undefined);
    if (watchdog.cancelled) throw new CancelledError();
    const diskError = sinkError ?? writeError;
    if (diskError !== undefined) throw failed(request, opened.finalUrl, `could not write ${partial}: ${messageOf(diskError)}`, diskHint, diskError);
    if (watchdog.timedOut) throw interrupted(request, opened.finalUrl, `no data for ${watchdog.idleSeconds} s`, error);
    throw interrupted(request, opened.finalUrl, messageOf(error), error);
  }
}

/** Resolves once the chunk has been handed to the file, with the write error when there was one. */
function writeChunk(sink: WriteStream, chunk: Uint8Array): Promise<Error | undefined> {
  return new Promise<Error | undefined>((resolvePromise) => {
    sink.write(chunk, (error: Error | null | undefined) => { resolvePromise(error ?? undefined); });
  });
}

/** Resolves once the file descriptor is closed, so the partial can be measured, renamed or removed. */
function whenClosed(sink: WriteStream): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    if (sink.closed) resolvePromise();
    else sink.once('close', () => resolvePromise());
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Checks size and checksums; a mismatch removes the partial and throws DownloadIntegrityError. */
async function verify(request: DownloadRequest, partial: string, bytes: number): Promise<Digests> {
  if (request.expectedBytes !== undefined && bytes !== request.expectedBytes) throw integrityFailure(request, partial, 'size', String(request.expectedBytes), String(bytes));
  const digests = await hashFile(partial, request.md5 !== undefined);
  if (request.sha256 !== undefined && digests.sha256 !== request.sha256.toLowerCase()) throw integrityFailure(request, partial, 'sha256', request.sha256, digests.sha256);
  if (request.md5 !== undefined && digests.md5 !== request.md5.toLowerCase()) throw integrityFailure(request, partial, 'md5', request.md5, digests.md5 ?? '');
  return digests;
}

/** Streams a file through SHA-256 and, when asked, MD5, without reading it into memory. */
function hashFile(path: string, withMd5: boolean): Promise<Digests> {
  return new Promise<Digests>((resolvePromise, rejectPromise) => {
    const sha256 = createHash('sha256');
    const md5 = withMd5 ? createHash('md5') : undefined;
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer | string) => { sha256.update(chunk); md5?.update(chunk); });
    stream.on('error', rejectPromise);
    stream.on('end', () => resolvePromise({ sha256: sha256.digest('hex'), ...(md5 === undefined ? {} : { md5: md5.digest('hex') }) }));
  });
}

function integrityFailure(request: DownloadRequest, partial: string, what: 'size' | 'sha256' | 'md5', expected: string, actual: string): DownloadIntegrityError {
  rmSync(partial, { force: true });
  return new DownloadIntegrityError(request.url, what, expected, actual);
}

/** The total size the server declared: Content-Length for a 200, the Content-Range total for a 206; undefined when unknown or encoded. */
function declaredTotalBytes(response: Response): number | undefined {
  const encoding = response.headers.get('content-encoding');
  if (encoding !== null && encoding !== 'identity') return undefined;
  if (response.status === 206) return contentRange(response)?.total;
  const length = response.headers.get('content-length');
  return length === null ? undefined : parseCount(length);
}

/** Parses `Content-Range: bytes start-end/total`; total is undefined when the server sent `*`. */
function contentRange(response: Response): { readonly start: number; readonly total: number | undefined } | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') ?? '');
  if (match === null) return undefined;
  return { start: Number(match[1]), total: match[3] === '*' ? undefined : parseCount(match[3] ?? '') };
}

function parseCount(text: string): number | undefined {
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Releases the connection of a response whose body is not wanted; a failure means it is already gone. */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch((): void => undefined);
}

function failed(request: DownloadRequest, url: string, reason: string, hint: string, cause: unknown): VisionForgeError {
  return new VisionForgeError({ code: 'download-failed', message: `${request.label}: could not download ${url}: ${reason}.`, hint, cause });
}

function interrupted(request: DownloadRequest, url: string, reason: string, cause: unknown): VisionForgeError {
  return new VisionForgeError({
    code: 'download-interrupted',
    message: `${request.label}: the download from ${url} was interrupted: ${reason}.`,
    hint: 'Run the command again; the download resumes from the bytes already saved.',
    cause,
  });
}
