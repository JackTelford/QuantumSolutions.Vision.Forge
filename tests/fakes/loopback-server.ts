/**
 * A node:http server on 127.0.0.1 for downloader tests. Routes serve a byte
 * buffer with Range support (206 and Content-Range, 416 past the end),
 * redirect to another path or to another loopback host alias such as
 * localhost, answer a fixed status, ignore Range headers, drop the connection
 * after N bytes, hold it open after N bytes until stop(), or hang without
 * ever sending headers. Every request is logged so tests can assert on the
 * headers the downloader sent.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/** One request the server received. */
export interface LoopbackRequest {
  readonly method: string;
  readonly path: string;
  readonly host: string;
  readonly range: string | undefined;
  readonly userAgent: string | undefined;
}

/** Options for a byte-buffer route. */
export interface FileRouteOptions {
  /** 'honor' answers a Range header with 206 (default); 'ignore' always answers 200 with the whole body. */
  readonly rangeMode?: 'honor' | 'ignore';
  /** Close the connection after this many body bytes, on the first `dropTimes` responses (default once). */
  readonly dropAfter?: number;
  readonly dropTimes?: number;
  /** Send this many body bytes, then keep the connection open without finishing until stop(). */
  readonly holdAfter?: number;
  readonly contentType?: string;
}

interface FileRoute {
  readonly kind: 'file';
  readonly body: Buffer;
  readonly options: FileRouteOptions;
  drops: number;
}

interface RedirectRoute {
  readonly kind: 'redirect';
  readonly status: number;
  readonly location: string;
}

interface StatusRoute {
  readonly kind: 'status';
  readonly status: number;
  readonly body: string;
}

interface HangRoute {
  readonly kind: 'hang';
}

type Route = FileRoute | RedirectRoute | StatusRoute | HangRoute;

/** The fixture. Register routes, start(), read `url` or urlFor(), stop() in after(). */
export class LoopbackServer {
  /** Every request received, in order. */
  readonly requests: LoopbackRequest[] = [];
  private readonly routes = new Map<string, Route>();
  private readonly server: Server;
  private port = 0;

  constructor() {
    this.server = createServer((request, response) => { this.handle(request, response); });
  }

  /** Base URL on 127.0.0.1; valid after start(). */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** URL of a path, optionally through another loopback host name such as `localhost`. */
  urlFor(path: string, host = '127.0.0.1'): string {
    return `http://${host}:${this.port}${path}`;
  }

  /** Serves a byte buffer at a path. */
  serveFile(path: string, body: Buffer, options: FileRouteOptions = {}): void {
    this.routes.set(path, { kind: 'file', body, options, drops: 0 });
  }

  /** Redirects a path to a location (a path or an absolute URL) with the given status. */
  redirect(path: string, location: string, status = 302): void {
    this.routes.set(path, { kind: 'redirect', status, location });
  }

  /** Answers a path with a fixed status and text body. */
  answer(path: string, status: number, body = ''): void {
    this.routes.set(path, { kind: 'status', status, body });
  }

  /** Never answers a path: the request is logged, then left open without headers until stop(). */
  hang(path: string): void {
    this.routes.set(path, { kind: 'hang' });
  }

  /** Listens on 127.0.0.1 at a free port. */
  start(): Promise<void> {
    return new Promise<void>((resolvePromise, rejectPromise) => {
      this.server.once('error', rejectPromise);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        this.port = typeof address === 'object' && address !== null ? address.port : 0;
        resolvePromise();
      });
    });
  }

  /** Closes every open connection (including held ones) and stops listening. */
  stop(): Promise<void> {
    return new Promise<void>((resolvePromise) => {
      this.server.closeAllConnections();
      this.server.close(() => resolvePromise());
    });
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const path = request.url ?? '/';
    this.requests.push({ method: request.method ?? 'GET', path, host: request.headers.host ?? '', range: header(request, 'range'), userAgent: header(request, 'user-agent') });
    const route = this.routes.get(path.split('?')[0] ?? path);
    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    switch (route.kind) {
      case 'redirect':
        response.writeHead(route.status, { location: route.location, 'content-length': '0' });
        response.end();
        return;
      case 'status':
        response.writeHead(route.status, { 'content-type': 'text/plain', 'content-length': String(Buffer.byteLength(route.body)) });
        response.end(route.body);
        return;
      case 'file':
        serveBytes(route, request, response);
        return;
      case 'hang':
        return;
    }
  }
}

function serveBytes(route: FileRoute, request: IncomingMessage, response: ServerResponse): void {
  const total = route.body.length;
  const rangeStart = route.options.rangeMode === 'ignore' ? undefined : parseRangeStart(header(request, 'range'));
  const headers: Record<string, string> = { 'content-type': route.options.contentType ?? 'application/octet-stream', 'accept-ranges': 'bytes' };
  let status = 200;
  let start = 0;
  if (rangeStart !== undefined) {
    if (rangeStart >= total) {
      response.writeHead(416, { 'content-range': `bytes */${total}` });
      response.end();
      return;
    }
    status = 206;
    start = rangeStart;
    headers['content-range'] = `bytes ${start}-${total - 1}/${total}`;
  }
  const slice = route.body.subarray(start);
  headers['content-length'] = String(slice.length);
  response.writeHead(status, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const { dropAfter, holdAfter } = route.options;
  if (dropAfter !== undefined && route.drops < (route.options.dropTimes ?? 1) && dropAfter < slice.length) {
    route.drops += 1;
    // End the socket (FIN) once the bytes are flushed: a destroy() would send a
    // RST, and Windows discards data the client has not read yet when a RST arrives.
    response.write(slice.subarray(0, dropAfter), () => { response.socket?.end(); });
    return;
  }
  if (holdAfter !== undefined && holdAfter < slice.length) {
    response.write(slice.subarray(0, holdAfter));
    return;
  }
  response.end(slice);
}

/** The start offset of a `bytes=start-` or `bytes=start-end` header; undefined when absent or malformed. */
function parseRangeStart(range: string | undefined): number | undefined {
  const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? '');
  return match === null ? undefined : Number(match[1]);
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}
