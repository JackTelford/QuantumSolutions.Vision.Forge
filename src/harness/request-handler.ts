/**
 * What the harness server does with a request: reads the config that names
 * the allowlisted roots, maps a URL path to a file inside one of them and
 * answers with the file, stripped of its types when it is TypeScript.
 *
 * The stripper itself is not imported here (only serve.ts may, ADR 0005):
 * handleRequest takes it as a function, so that this module can be used and
 * tested in-process. serve.ts is the entry point that wires it to a server.
 *
 * Bodies carry nothing but the file served or a fixed status text; error
 * details go to standard error only.
 */
import { createReadStream, readFileSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream';
import { DataFileError } from '../errors/vision-forge-error.ts';
import { readJsonFile } from '../fs/atomic-json.ts';
import { contentTypeFor, javascriptContentType } from './mime-types.ts';
import { findRoot, resolveWithinRoot } from './static-roots.ts';
import type { ServedRoot } from './static-roots.ts';

/** What the config file holds. HarnessServer writes it; the serve process reads it. */
export interface ServeConfig {
  readonly roots: readonly ServedRoot[];
  /** 0 or absent: the operating system picks a free port. */
  readonly port?: number;
}

/** Turns TypeScript source into JavaScript; serve.ts passes Node's stripper. */
export type StripFunction = (source: string) => string;

/** The address the server binds; requests must name it (or localhost) in their Host header. */
export const loopback = '127.0.0.1';

/** The body of every 500 answer: the cause goes to standard error, never to the client. */
export const internalErrorText = 'internal error';

const textType = 'text/plain; charset=utf-8';
const allowedHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

/** Headers every response carries: nothing is sniffed, nothing is cached. */
const baseHeaders: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

function configError(path: string, reason: string): DataFileError {
  return new DataFileError(path, reason, 'The config is written by HarnessServer (src/harness/harness-server.ts); start the server through it.');
}

function parseRoot(path: string, entry: unknown, index: number): ServedRoot {
  if (typeof entry !== 'object' || entry === null) throw configError(path, `roots[${index}] is not an object`);
  const record = entry as Record<string, unknown>;
  const urlPrefix = record['urlPrefix'];
  const directory = record['directory'];
  if (typeof urlPrefix !== 'string' || !urlPrefix.startsWith('/') || !urlPrefix.endsWith('/')) {
    throw configError(path, `roots[${index}].urlPrefix must start and end with "/"`);
  }
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw configError(path, `roots[${index}].directory must be an absolute path`);
  return { urlPrefix, directory };
}

/** Reads and validates the config file. */
export function readServeConfig(path: string): ServeConfig {
  const raw = readJsonFile(path);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw configError(path, 'it is not a JSON object');
  const record = raw as Record<string, unknown>;
  const rootsRaw = record['roots'];
  if (!Array.isArray(rootsRaw) || rootsRaw.length === 0) throw configError(path, '"roots" must be a non-empty array');
  const roots = rootsRaw.map((entry: unknown, index: number) => parseRoot(path, entry, index));
  const port = record['port'];
  if (port === undefined) return { roots };
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) throw configError(path, '"port" must be an integer from 0 to 65535');
  return { roots, port };
}

function fileStats(path: string): Stats | undefined {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats : undefined;
  } catch {
    return undefined;
  }
}

/** The path component of a request URL, or undefined when the URL does not parse. */
export function requestPath(url: string | undefined): string | undefined {
  try {
    return new URL(url ?? '/', `http://${loopback}`).pathname;
  } catch {
    return undefined;
  }
}

/** Answers with a short plain-text body and the base headers. */
export function sendText(response: ServerResponse, status: number, text: string, extra: Readonly<Record<string, string>> = {}): void {
  const body = Buffer.from(text, 'utf8');
  response.writeHead(status, { ...baseHeaders, ...extra, 'Content-Type': textType, 'Content-Length': String(body.byteLength) });
  response.end(body);
}

/** Answers with a TypeScript file stripped to JavaScript; read whole so that HEAD reports the exact length. */
export function sendStripped(target: string, strip: StripFunction, method: string, response: ServerResponse): void {
  const body = Buffer.from(strip(readFileSync(target, 'utf8')), 'utf8');
  response.writeHead(200, { ...baseHeaders, 'Content-Type': javascriptContentType, 'Content-Length': String(body.byteLength) });
  response.end(method === 'HEAD' ? undefined : body);
}

/** Answers with a file's bytes, streamed; a read error aborts the response and leaves a line on standard error. */
export function sendFile(target: string, stats: Stats, method: string, response: ServerResponse): void {
  response.writeHead(200, { ...baseHeaders, 'Content-Type': contentTypeFor(extname(target)), 'Content-Length': String(stats.size) });
  if (method === 'HEAD') {
    response.end();
    return;
  }
  // The callback gets undefined, not null, on success; the typing says null.
  pipeline(createReadStream(target), response, (error: NodeJS.ErrnoException | null | undefined) => {
    if (error === null || error === undefined) return;
    process.stderr.write(`error streaming ${target}: ${error.message}\n`);
    response.destroy();
  });
}

/**
 * Answers one request from the allowlisted roots. Never reads the request
 * body. Refuses methods other than GET and HEAD (405), a Host header that
 * is not loopback (400, against DNS rebinding) and anything outside the
 * roots (404). Throws only when reading or stripping a file fails; the
 * caller answers 500.
 */
export function handleRequest(roots: readonly ServedRoot[], strip: StripFunction, request: IncomingMessage, response: ServerResponse): void {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(response, 405, 'method not allowed', { Allow: 'GET, HEAD' });
    return;
  }
  const host = request.headers.host ?? '';
  if (!allowedHost.test(host)) {
    sendText(response, 400, 'bad request');
    return;
  }
  const urlPath = requestPath(request.url);
  if (urlPath === undefined) {
    sendText(response, 400, 'bad request');
    return;
  }
  if (urlPath === '/favicon.ico') {
    response.writeHead(204, baseHeaders);
    response.end();
    return;
  }
  const root = findRoot(roots, urlPath);
  const target = root === undefined ? undefined : resolveWithinRoot(root, urlPath);
  const stats = target === undefined ? undefined : fileStats(target);
  if (target === undefined || stats === undefined) {
    sendText(response, 404, 'not found');
    return;
  }
  if (extname(target).toLowerCase() === '.ts') {
    sendStripped(target, strip, method, response);
    return;
  }
  sendFile(target, stats, method, response);
}
