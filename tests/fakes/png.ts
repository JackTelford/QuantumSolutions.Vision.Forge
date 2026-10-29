/**
 * Valid solid-colour PNGs written without ffmpeg or any image library, so
 * the render tests can produce frames on a machine without a browser: the
 * signature, an IHDR (8-bit RGB), one IDAT of zlib-deflated rows (filter
 * type 0 on every row) and IEND, each chunk with its CRC-32. Not a test
 * file: the test runner never loads it on its own.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';

/** An sRGB colour as three bytes. */
export type Rgb = readonly [number, number, number];

/** The CRC-32 lookup table of the PNG specification (polynomial 0xEDB88320), built once. */
const crcTable: readonly number[] = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 of a byte array as PNG chunks carry it. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** The bytes of a width x height PNG filled with one colour. */
export function solidPngBytes(width: number, height: number, rgb: Rgb): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour (RGB)
  header[10] = 0; // compression method
  header[11] = 0; // filter method
  header[12] = 0; // no interlace
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter type 0: the row is stored as is
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 3;
      raw[at] = rgb[0];
      raw[at + 1] = rgb[1];
      raw[at + 2] = rgb[2];
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

/** Writes a solid-colour PNG to the path, creating its directory. */
export function writeSolidPng(path: string, width: number, height: number, rgb: Rgb): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, solidPngBytes(width, height, rgb));
}

/** A colour that depends on the frame number only, so two renders of a frame agree and two frames differ. */
export function frameColor(frame: number): Rgb {
  return [frame % 256, (frame * 7) % 256, (frame * 13) % 256];
}
