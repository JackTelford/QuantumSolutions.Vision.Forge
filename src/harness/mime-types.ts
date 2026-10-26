/**
 * Content types the harness server sends, by file extension.
 *
 * `.ts` is listed as JavaScript on purpose: the server strips the types
 * before it answers (ADR 0005). Generic servers map it to `video/mp2t`,
 * which module scripts refuse. Anything not listed is served as raw bytes;
 * with `X-Content-Type-Options: nosniff` the browser never guesses.
 */

/** Content type of JavaScript, and of TypeScript stripped to JavaScript. */
export const javascriptContentType = 'text/javascript; charset=utf-8';

/** What a file with an unlisted extension is served as. */
export const fallbackContentType = 'application/octet-stream';

/** Content types by lower-case extension, dot included. */
export const mimeTypes: Readonly<Record<string, string>> = {
  '.ts': javascriptContentType,
  '.js': javascriptContentType,
  '.mjs': javascriptContentType,
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.hdr': fallbackContentType,
  '.exr': fallbackContentType,
  '.bin': fallbackContentType,
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
};

/** The content type for an extension (dot included, any case); the fallback when unlisted. */
export function contentTypeFor(extension: string): string {
  return mimeTypes[extension.toLowerCase()] ?? fallbackContentType;
}
