/**
 * The asset ledger: `assets.json` under the data directory, one record per
 * downloaded asset (fonts, HDRIs, model weights) with its source, license,
 * hashes and the files it produced. Commands consult it before downloading
 * again and credit files are generated from it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataFileError, VisionForgeError } from '../errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../fs/atomic-json.ts';

/** One downloaded asset and where it came from. */
export interface AssetRecord {
  /** Stable identifier chosen by the command that downloads the asset, for example "font:inter". */
  readonly id: string;
  /** The URL the download started from. */
  readonly source: string;
  /** The URL that served the bytes after redirects. */
  readonly finalUrl: string;
  /** SPDX identifier or license name. */
  readonly license: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly md5?: string;
  /** ISO 8601 time of the download. */
  readonly fetchedAt: string;
  /** Attribution text the source asks for, when any. */
  readonly credit?: string;
  /** Paths, relative to the data directory, that belong to this asset. */
  readonly files: readonly string[];
}

/** The on-disk document. */
export interface AssetLedgerDocument {
  readonly kind: 'assets-ledger';
  readonly version: 1;
  readonly assets: readonly AssetRecord[];
}

/** File name of the ledger inside the data directory. */
export const assetLedgerFileName = 'assets.json';

/** The ledger path for a data directory. */
export function assetLedgerPath(dataDir: string): string {
  return join(dataDir, assetLedgerFileName);
}

/** The ledger: load, record, find, save. Records are kept by id; saving sorts them by id so the file is stable. */
export class AssetLedger {
  readonly path: string;
  private readonly records = new Map<string, AssetRecord>();

  constructor(path: string) {
    this.path = path;
  }

  /** Reads the ledger file; a missing file is an empty ledger. Throws DataFileError on a malformed one. */
  load(): void {
    this.records.clear();
    if (!existsSync(this.path)) return;
    const document = parseDocument(this.path, readJsonFile(this.path));
    for (const record of document.assets) this.records.set(record.id, record);
  }

  /** Writes the ledger atomically. */
  save(): void {
    const document: AssetLedgerDocument = { kind: 'assets-ledger', version: 1, assets: this.all() };
    writeJsonAtomic(this.path, document);
  }

  /** Adds a record, replacing any record with the same id. A record load() would reject throws VisionForgeError (code ledger-record) and changes nothing. */
  record(record: AssetRecord): void {
    const problem = recordProblem(record);
    if (problem !== undefined) {
      throw new VisionForgeError({
        code: 'ledger-record',
        message: `Cannot record asset ${JSON.stringify(record.id)}: it ${problem}.`,
        hint: 'This is a bug in the command that downloaded the asset; nothing was written.',
      });
    }
    this.records.set(record.id, record);
  }

  /** The record with this id, or undefined. */
  find(id: string): AssetRecord | undefined {
    return this.records.get(id);
  }

  /** Every record, sorted by id. */
  all(): readonly AssetRecord[] {
    return [...this.records.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

const badFileHint = 'Delete the file to start a fresh ledger (installed assets are downloaded again), or restore it from a backup.';
const requiredStrings = ['id', 'source', 'finalUrl', 'license', 'sha256', 'fetchedAt'] as const;
const optionalStrings = ['md5', 'credit'] as const;

function parseDocument(path: string, value: unknown): AssetLedgerDocument {
  if (!isObject(value)) throw new DataFileError(path, 'it is not a JSON object', badFileHint);
  if (value['kind'] !== 'assets-ledger') throw new DataFileError(path, `its kind is ${JSON.stringify(value['kind'])}, not "assets-ledger"`, badFileHint);
  if (value['version'] !== 1) throw new DataFileError(path, `its version is ${JSON.stringify(value['version'])}, not 1`, badFileHint);
  const raw = value['assets'];
  if (!Array.isArray(raw)) throw new DataFileError(path, 'its "assets" field is not an array', badFileHint);
  const entries: readonly unknown[] = raw;
  const assets = entries.map((entry, index) => {
    const problem = recordProblem(entry);
    if (problem !== undefined || !isAssetRecord(entry)) throw new DataFileError(path, `assets[${index}] ${problem ?? 'is invalid'}`, badFileHint);
    return entry;
  });
  return { kind: 'assets-ledger', version: 1, assets };
}

function isAssetRecord(value: unknown): value is AssetRecord {
  return recordProblem(value) === undefined;
}

/** Describes the first thing wrong with a would-be record, or undefined when it is valid. */
function recordProblem(value: unknown): string | undefined {
  if (!isObject(value)) return 'is not an object';
  for (const field of requiredStrings) {
    const text = value[field];
    if (typeof text !== 'string' || text.length === 0) return `has no "${field}" string`;
  }
  const bytes = value['bytes'];
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) return 'has no non-negative integer "bytes"';
  for (const field of optionalStrings) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return `has a "${field}" that is not a string`;
  }
  const files = value['files'];
  if (!Array.isArray(files) || !files.every((file: unknown) => typeof file === 'string')) return 'has no "files" array of strings';
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
