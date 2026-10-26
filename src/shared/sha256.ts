/**
 * SHA-256 through the Web Crypto API, which exists in Node and in browsers.
 * Content hashes of specs and manifests are built here so every lane keys
 * its outputs the same way.
 */
import { canonicalJson } from './canonical-json.ts';

/** Lowercase hexadecimal of a byte array. */
export function toHex(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += byte.toString(16).padStart(2, '0');
  return text;
}

/** SHA-256 of a string (UTF-8) or of raw bytes, as lowercase hex. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/** SHA-256 of a value's canonical JSON. Two values with equal content always hash alike. */
export function contentHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

/** The first `length` characters of a content hash, for folder names. */
export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}
