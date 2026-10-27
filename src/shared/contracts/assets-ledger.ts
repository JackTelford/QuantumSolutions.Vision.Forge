/** @generated from schemas/assets-ledger.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Every asset downloaded into the data directory (fonts, HDRIs, model weights) with its source, license, hashes and files. Written as assets.json under the data directory by src/net/asset-ledger.ts; commands consult it before downloading again and credits are generated from it.
 */
export interface AssetsLedger {
  /**
   * Document kind; always "assets-ledger".
   */
  kind: 'assets-ledger';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * The downloaded assets, sorted by id; empty when nothing has been downloaded.
   */
  assets: AssetRecord[];
}
/**
 * One downloaded asset and where it came from.
 *
 * This interface was referenced by `AssetsLedger`'s JSON-Schema
 * via the `definition` "AssetRecord".
 */
export interface AssetRecord {
  /**
   * Stable identifier chosen by the command that downloaded the asset, unique within the ledger, for example "font:inter" or "hdri:studio_small_09".
   */
  id: string;
  /**
   * The URL the download started from, for example https://dl.polyhaven.com/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr.
   */
  source: string;
  /**
   * The URL that served the bytes after redirects, for example https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr.
   */
  finalUrl: string;
  /**
   * SPDX identifier or license name, for example "CC0-1.0" or "OFL-1.1".
   */
  license: string;
  /**
   * Size of the downloaded file in bytes, for example 1615248.
   */
  bytes: number;
  /**
   * SHA-256 of the downloaded file as 64 lowercase hex characters, verified against the pin.
   */
  sha256: string;
  /**
   * MD5 of the downloaded file as 32 lowercase hex characters; present when the source publishes one.
   */
  md5?: string;
  /**
   * When the download finished: an RFC 3339 timestamp in UTC with millisecond precision, for example 2026-10-26T12:01:00.000Z.
   */
  fetchedAt: string;
  /**
   * Attribution text the source asks for, for example "HDRI by Poly Haven (CC0)"; present when there is one.
   */
  credit?: string;
  /**
   * Paths, relative to the data directory with forward slashes, that belong to this asset; at least the downloaded file.
   *
   * Items: One relative path, for example "hdri/studio_small_09_1k.hdr".
   */
  files: string[];
}
