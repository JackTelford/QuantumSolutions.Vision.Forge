/**
 * Images beside a JSON result (ADR 0009 decision 5): a still or a contact
 * sheet is read from disk and sent as base64 image content, so the model
 * looks at the frame as the still loop demands. Clients cap message size, so
 * an image over 4 MB encoded is replaced by a sentence naming its path, and
 * a file that cannot be read is reported the same way rather than failing a
 * tool call whose command already succeeded.
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ToolContent } from '../types.ts';

/** The largest base64 payload sent inline, in characters (4 MB). */
export const maxEncodedImageBytes = 4 * 1024 * 1024;

/** The image MIME type a file extension names; undefined for anything but PNG and JPEG. */
export function imageMimeType(path: string): 'image/png' | 'image/jpeg' | undefined {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return undefined;
}

/**
 * The image at the path as image content, or a text note when it is not a
 * PNG or JPEG, cannot be read, or exceeds the encoded limit. `what` names
 * the image in the note ("the finished still").
 */
export async function imageContent(path: string, what: string): Promise<ToolContent> {
  const mimeType = imageMimeType(path);
  if (mimeType === undefined) return { type: 'text', text: `${capitalize(what)} is at ${path}; only PNG and JPEG images are sent inline.` };
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error: unknown) {
    return { type: 'text', text: `${capitalize(what)} at ${path} could not be read (${error instanceof Error ? error.message : String(error)}); open it from the path.` };
  }
  const data = bytes.toString('base64');
  if (data.length > maxEncodedImageBytes) {
    return { type: 'text', text: `${capitalize(what)} at ${path} is ${(data.length / (1024 * 1024)).toFixed(1)} MB encoded, over the ${maxEncodedImageBytes / (1024 * 1024)} MB limit for inline images; open it from the path.` };
  }
  return { type: 'image', data, mimeType };
}

function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}
