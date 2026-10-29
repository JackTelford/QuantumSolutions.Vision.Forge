/**
 * Fetching and checking one catalogue entry: download it through the
 * HttpDownloader into the data directory, record it in the ledger, and later
 * re-hash the file against that record. The catalogue says what is allowed;
 * this file moves the bytes.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../cli/logger.ts';
import { VisionForgeError } from '../errors/vision-forge-error.ts';
import { networkAllowlist } from '../net/allowlist.ts';
import type { AssetLedger, AssetRecord } from '../net/asset-ledger.ts';
import { HttpDownloader } from '../net/http-downloader.ts';
import type { CatalogueEntry } from './catalogue.ts';

/** The User-Agent every asset download sends; Poly Haven asks for one that names the client. */
export const assetsUserAgent = 'vision-forge/0.0.0 (+https://github.com/JackTelford/QuantumSolutions.Vision.Forge)';

/** What fetchAsset needs. */
export interface FetchAssetOptions {
  readonly entry: CatalogueEntry;
  readonly dataDir: string;
  readonly downloader: HttpDownloader;
  /** Loaded by the caller; fetchAsset records into it and saves it after a download. */
  readonly ledger: AssetLedger;
  readonly log: Logger;
  /** The clock for the record's fetchedAt; when absent the downloader's own clock is used. */
  readonly now?: () => Date;
}

/** The ledger record of the asset and whether this call downloaded it. */
export interface FetchAssetResult {
  readonly record: AssetRecord;
  /** False when the asset was already installed and nothing was fetched. */
  readonly downloaded: boolean;
}

/** What verifyAsset found. */
export interface VerifyAssetResult {
  readonly ok: boolean;
  /** One sentence: what matched, or what differs. */
  readonly reason: string;
}

/** A downloader for the production allowlist, as the assets command uses it. */
export function createAssetDownloader(log: Logger, now?: () => Date): HttpDownloader {
  return new HttpDownloader({ allowlist: networkAllowlist, userAgent: assetsUserAgent, log, ...(now === undefined ? {} : { now }) });
}

/** The absolute path an entry's file has under the data directory. */
export function assetPath(dataDir: string, entry: CatalogueEntry): string {
  return join(dataDir, ...entry.file.split('/'));
}

/**
 * True when the ledger has the entry under the pinned MD5 and the file is on
 * disk at the pinned size. The MD5 comparison makes a re-pinned catalogue
 * entry (new upstream file, new hash) count as not installed, so it is
 * fetched again instead of served stale.
 */
export function isInstalled(entry: CatalogueEntry, dataDir: string, ledger: AssetLedger): boolean {
  const record = ledger.find(entry.id);
  if (record === undefined || record.md5 !== entry.md5) return false;
  const path = assetPath(dataDir, entry);
  return existsSync(path) && statSync(path).size === entry.bytes;
}

/**
 * Downloads the entry unless it is installed, records it and saves the
 * ledger. The downloader verifies size and MD5 before the file reaches its
 * destination, so a record is only ever written for verified bytes.
 */
export async function fetchAsset(options: FetchAssetOptions, signal: AbortSignal): Promise<FetchAssetResult> {
  const { entry, dataDir, downloader, ledger, log, now } = options;
  const existing = ledger.find(entry.id);
  if (existing !== undefined && isInstalled(entry, dataDir, ledger)) {
    log.info(`${entry.id}: already installed at ${assetPath(dataDir, entry)}`);
    return { record: existing, downloaded: false };
  }
  const result = await downloader.download({ url: entry.url, destination: assetPath(dataDir, entry), expectedBytes: entry.bytes, md5: entry.md5, label: entry.id }, signal);
  const record: AssetRecord = {
    id: entry.id,
    source: entry.url,
    finalUrl: result.finalUrl,
    license: entry.license,
    bytes: result.bytes,
    sha256: result.sha256,
    md5: result.md5 ?? entry.md5,
    fetchedAt: now === undefined ? result.fetchedAt : now().toISOString(),
    credit: entry.credit,
    files: [entry.file],
  };
  ledger.record(record);
  ledger.save();
  log.info(`${entry.id}: downloaded ${result.bytes} bytes from ${result.finalUrl}`);
  return { record, downloaded: true };
}

/** Re-hashes the entry's file and compares it with the ledger record. */
export async function verifyAsset(entry: CatalogueEntry, dataDir: string, ledger: AssetLedger): Promise<VerifyAssetResult> {
  const record = ledger.find(entry.id);
  if (record === undefined) return { ok: false, reason: `${entry.id} is not in the ledger` };
  const path = assetPath(dataDir, entry);
  if (!existsSync(path)) return { ok: false, reason: `${path} does not exist` };
  const size = statSync(path).size;
  if (size !== record.bytes) return { ok: false, reason: `${path} is ${size} bytes, the ledger recorded ${record.bytes}` };
  const sha256 = await sha256File(path);
  if (sha256 !== record.sha256) return { ok: false, reason: `${path} hashes to sha256 ${sha256}, the ledger recorded ${record.sha256}` };
  return { ok: true, reason: `${path} matches the ledger (${size} bytes, sha256 ${sha256})` };
}

/** The path a failed file is moved to by setAside, next to the original. */
export function corruptPath(path: string): string {
  return `${path}.corrupt`;
}

/**
 * Moves a file that failed verification to `<path>.corrupt` (replacing an
 * older one) so isInstalled no longer counts it and the next fetch downloads
 * again; a file that is already gone needs nothing. Returns the new path, or
 * undefined when there was no file. The ledger record stays: the ledger has
 * no remove, and the record is replaced by the next successful download.
 */
export function setAside(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const aside = corruptPath(path);
  renameSync(path, aside);
  return aside;
}

/** Streams a file through SHA-256; the HDRIs are several megabytes, so they are never read whole. */
export function sha256File(path: string): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer | string) => { hash.update(chunk); });
    // A file that exists but cannot be opened (permissions, a scanner holding it) must reach the user with a hint, not as a stack trace.
    stream.on('error', (error: Error) => rejectPromise(new VisionForgeError({
      code: 'asset-read',
      message: `Cannot read ${path}: ${error.message}.`,
      hint: 'Check the file permissions and that no other program holds it, then run assets --verify again.',
      cause: error,
    })));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}
