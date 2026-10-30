/**
 * Documents passed in the call instead of by path (ADR 0009 decision 4).
 * Not every client can write files, so plan, validate and audio_synth take
 * their inputs inline; they are written under `<out>/documents/` named by a
 * content hash and the command reads them from there like any file. The
 * plan quartet goes under `<out>/documents/<hash>/`, where the hash is the
 * first eight hex characters of the SHA-256 of the canonical JSON of the
 * object `{ brief, treatment, shotSpec, look }`, the same value the job id
 * is taken from, so a fully inline plan's folder name is its job id.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from '../../fs/atomic-json.ts';
import { contentHash, sha256Hex, shortHash } from '../../shared/sha256.ts';

/** The four plan documents, keyed as the plan tool's input names them. */
export const inlineDocumentKinds = ['brief', 'treatment', 'shotSpec', 'look'] as const;

/** One of brief, treatment, shotSpec, look. */
export type InlineDocumentKind = (typeof inlineDocumentKinds)[number];

/** The file each kind is written as, matching the names a job folder uses. */
export const inlineDocumentFileNames: Readonly<Record<InlineDocumentKind, string>> = {
  brief: 'brief.json',
  treatment: 'treatment.json',
  shotSpec: 'shot-spec.json',
  look: 'look-bible.json',
};

/** How many hex characters of the content hash name an inline document; eight, like a job id. */
export const inlineHashLength = 8;

/** The folder inline documents land in: `<out>/documents`. */
export function documentsDir(outDir: string): string {
  return join(outDir, 'documents');
}

/**
 * Writes the inline members of the quartet as JSON under
 * `<out>/documents/<hash>/` and returns the path of each one written. The
 * hash covers the members given, so a fully inline quartet hashes like the
 * job id and a mixed call hashes its inline part.
 */
export async function writeInlineDocuments(outDir: string, documents: Readonly<Partial<Record<InlineDocumentKind, unknown>>>): Promise<Partial<Record<InlineDocumentKind, string>>> {
  const present = inlineDocumentKinds.filter((kind) => documents[kind] !== undefined);
  if (present.length === 0) return {};
  const hashed: Partial<Record<InlineDocumentKind, unknown>> = {};
  for (const kind of present) hashed[kind] = documents[kind];
  const dir = join(documentsDir(outDir), shortHash(await contentHash(hashed), inlineHashLength));
  const paths: Partial<Record<InlineDocumentKind, string>> = {};
  for (const kind of present) {
    const path = join(dir, inlineDocumentFileNames[kind]);
    writeJsonAtomic(path, documents[kind]);
    paths[kind] = path;
  }
  return paths;
}

/** Writes one inline JSON document as `<out>/documents/<label>-<hash>.json` and returns its path. */
export async function writeInlineDocument(outDir: string, label: string, document: unknown): Promise<string> {
  const path = join(documentsDir(outDir), `${label}-${shortHash(await contentHash(document), inlineHashLength)}.json`);
  writeJsonAtomic(path, document);
  return path;
}

/** Writes inline text as `<out>/documents/<label>-<hash>.txt` (UTF-8) and returns its path. */
export async function writeInlineText(outDir: string, label: string, text: string): Promise<string> {
  const dir = documentsDir(outDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${label}-${shortHash(await sha256Hex(text), inlineHashLength)}.txt`);
  writeFileSync(path, text, 'utf8');
  return path;
}
