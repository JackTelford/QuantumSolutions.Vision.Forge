/**
 * A GET through node:http for the harness tests. The global fetch (undici)
 * replaces a caller-set Host header with the URL's, so the Host checks go
 * through http.request, which sends the header as given.
 */
import { request } from 'node:http';

/** Status and body of one GET answer. */
export interface SimpleResponse {
  readonly status: number;
  readonly body: string;
}

/** Sends GET `path` to the server at `base` with exactly the given Host header. */
export function getWithHost(base: string, path: string, host: string): Promise<SimpleResponse> {
  const url = new URL(base);
  return new Promise<SimpleResponse>((resolveResponse, rejectResponse) => {
    const outgoing = request({ hostname: url.hostname, port: Number(url.port), path, method: 'GET', headers: { Host: host } }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      incoming.on('end', () => { resolveResponse({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }); });
      incoming.on('error', rejectResponse);
    });
    outgoing.on('error', rejectResponse);
    outgoing.end();
  });
}
