/**
 * Loads the look's bundled fonts before the first frame, so no frame is
 * ever captured with a fallback face. The page carries the @font-face
 * rules (typography/scale.ts); this asks the font set for every face the
 * roles use and then verifies each one is available.
 */
import type { LookBible } from '../../shared/contracts/look-bible.ts';
import { fontFacesToLoad } from '../../shared/typography/scale.ts';

/** Which faces loaded, as "family weight" strings, and which did not, as the descriptor asked for plus the reason in parentheses. */
export interface FontLoadResult {
  readonly loaded: readonly string[];
  readonly failed: readonly string[];
}

/** "700 16px 'Playfair Display'" as "Playfair Display 700", the form the InitReport lists; an unexpected descriptor is kept as is. */
export function fontLabel(descriptor: string): string {
  const match = /^(\d+) 16px '(.+)'$/.exec(descriptor);
  return match === null ? descriptor : `${match[2] ?? ''} ${match[1] ?? ''}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Asks the document to load every face the look uses, waits for the set to
 * settle, then checks each face is present. Each descriptor is loaded on
 * its own because `load` rejects (a bare NetworkError) when a face's file
 * cannot be fetched, and the report must name the face; an empty result
 * means no @font-face rule matched the descriptor, which `check` would
 * otherwise pass as loaded while the frame renders in a fallback font.
 */
export async function loadLookFonts(fonts: FontFaceSet, typography: LookBible['typography']): Promise<FontLoadResult> {
  const descriptors = fontFacesToLoad(typography);
  const failed: string[] = [];
  for (const descriptor of descriptors) {
    try {
      const faces = await fonts.load(descriptor);
      if (faces.length === 0) failed.push(`${descriptor} (no @font-face rule matches it)`);
    } catch (error: unknown) {
      failed.push(`${descriptor} (${messageOf(error)})`);
    }
  }
  await fonts.ready;
  const loaded: string[] = [];
  for (const descriptor of descriptors) {
    if (failed.some((entry) => entry.startsWith(`${descriptor} (`))) continue;
    if (fonts.check(descriptor)) loaded.push(fontLabel(descriptor));
    else failed.push(`${descriptor} (not available after loading)`);
  }
  return { loaded, failed };
}
