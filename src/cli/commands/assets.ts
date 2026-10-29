/**
 * `assets`: the pinned catalogue of downloadable CC0 assets and what is
 * installed under the data directory.
 *
 * `--list` (the default) prints one line per catalogue entry; `--fetch
 * <id,id>` and `--all` download into `<dataDir>/assets/` through the
 * allowlisted downloader and record the ledger; `--verify` re-hashes every
 * installed asset against the ledger; `--credits` writes CREDITS.md to
 * `<out>/CREDITS.md` or to `--credits-path <path>`. Actions combine; each
 * adds its field to the result's data, and the list reflects the state after
 * any download or verification ran.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { catalogue, catalogueIds, findCatalogueEntry } from '../../assets/catalogue.ts';
import type { CatalogueEntry } from '../../assets/catalogue.ts';
import { creditsMarkdown } from '../../assets/credits.ts';
import { assetPath, createAssetDownloader, fetchAsset, isInstalled, setAside, verifyAsset } from '../../assets/fetch.ts';
import { CancelledError, UsageError, VisionForgeError } from '../../errors/vision-forge-error.ts';
import { ensureDirectory } from '../../fs/paths.ts';
import { AssetLedger, assetLedgerPath } from '../../net/asset-ledger.ts';
import type { Command, CommandContext } from '../command.ts';
import type { ParsedArguments } from '../arguments.ts';
import type { CommandOutput } from '../result.ts';

/** One catalogue entry as --list reports it. */
export interface ListedAsset {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly bytes: number;
  readonly license: string;
  readonly installed: boolean;
  /** Absolute path the file has, or would have, under the data directory. */
  readonly file: string;
}

/** One asset --fetch or --all handled. */
export interface FetchedAsset {
  readonly id: string;
  /** False when it was already installed. */
  readonly downloaded: boolean;
  readonly path: string;
  readonly sha256: string;
}

/** One installed asset --verify checked. */
export interface VerifiedAsset {
  readonly id: string;
  readonly ok: boolean;
  readonly reason: string;
}

/** Shape of the assets payload: one field per action that ran. */
export interface AssetsData {
  readonly assets?: readonly ListedAsset[];
  readonly fetched?: readonly FetchedAsset[];
  readonly verified?: readonly VerifiedAsset[];
  /** Absolute path of the credits file. */
  readonly credits?: string;
}

/** Bytes as megabytes (1 MB = 1 000 000 bytes) with one decimal, for the list lines. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The entries named in a comma-separated --fetch value, each once, in the order given; an unknown id is a usage error listing the known ones. */
export function parseFetchIds(value: string): readonly CatalogueEntry[] {
  const ids = [...new Set(value.split(',').map((id) => id.trim()).filter((id) => id.length > 0))];
  if (ids.length === 0) throw new UsageError('--fetch names no asset.', `Pass --fetch <id,id>. Known ids: ${catalogueIds().join(', ')}.`);
  const unknown = ids.filter((id) => findCatalogueEntry(id) === undefined);
  if (unknown.length > 0) throw new UsageError(`Unknown asset id${unknown.length === 1 ? '' : 's'} ${unknown.map((id) => JSON.stringify(id)).join(', ')}.`, `Known ids: ${catalogueIds().join(', ')}.`);
  return ids.map((id) => findCatalogueEntry(id)).filter((entry): entry is CatalogueEntry => entry !== undefined);
}

/** The entries --fetch and --all ask for together, each once, in catalogue order. */
export function selectEntries(fetch: string | undefined, all: boolean): readonly CatalogueEntry[] {
  const chosen = new Set<string>(all ? catalogueIds() : []);
  if (fetch !== undefined) for (const entry of parseFetchIds(fetch)) chosen.add(entry.id);
  return catalogue.filter((entry) => chosen.has(entry.id));
}

/** The --list lines and payload, as installed stands when it is called. */
function listAssets(context: CommandContext, ledger: AssetLedger): readonly ListedAsset[] {
  return catalogue.map((entry) => {
    const installed = isInstalled(entry, context.dataDir, ledger);
    context.log.info(`${entry.id}  ${formatMegabytes(entry.bytes)}  installed: ${installed ? 'yes' : 'no'}`);
    return { id: entry.id, kind: entry.kind, name: entry.name, bytes: entry.bytes, license: entry.license, installed, file: assetPath(context.dataDir, entry) };
  });
}

/** Downloads the entries one after another; the downloader logs the size and the final URL of each. */
async function fetchEntries(context: CommandContext, ledger: AssetLedger, entries: readonly CatalogueEntry[]): Promise<readonly FetchedAsset[]> {
  const downloader = createAssetDownloader(context.log, context.now);
  const fetched: FetchedAsset[] = [];
  for (const entry of entries) {
    const result = await fetchAsset({ entry, dataDir: context.dataDir, downloader, ledger, log: context.log, now: context.now }, context.signal);
    fetched.push({ id: entry.id, downloaded: result.downloaded, path: assetPath(context.dataDir, entry), sha256: result.record.sha256 });
  }
  return fetched;
}

/**
 * Re-hashes every installed catalogue entry. A file that differs is moved to
 * `<path>.corrupt` so the asset no longer counts as installed and the next
 * --fetch downloads it again; then asset-integrity is thrown naming the ids.
 */
async function verifyInstalled(context: CommandContext, ledger: AssetLedger): Promise<readonly VerifiedAsset[]> {
  const verified: VerifiedAsset[] = [];
  const setAsideTo: string[] = [];
  for (const entry of catalogue) {
    if (ledger.find(entry.id) === undefined) continue;
    // Hashing a 6 MB file takes a moment; Ctrl+C between entries must stop here instead of after the last one.
    if (context.signal.aborted) throw new CancelledError();
    const result = await verifyAsset(entry, context.dataDir, ledger);
    context.log.info(`${entry.id}: ${result.ok ? 'ok' : 'FAILED'}: ${result.reason}`);
    verified.push({ id: entry.id, ...result });
    if (!result.ok) {
      const aside = setAside(assetPath(context.dataDir, entry));
      if (aside !== undefined) {
        context.log.info(`${entry.id}: moved the failed file to ${aside}`);
        setAsideTo.push(aside);
      }
    }
  }
  const failedIds = verified.filter((entry) => !entry.ok).map((entry) => entry.id);
  if (failedIds.length > 0) {
    // The moved files are named in the hint because the result's data is null on failure and the reasons above are only logged.
    const moved = setAsideTo.length === 0 ? '' : ` The failed file${setAsideTo.length === 1 ? ' was' : 's were'} moved to ${setAsideTo.join(', ')}.`;
    throw new VisionForgeError({
      code: 'asset-integrity',
      message: `${failedIds.length} installed asset${failedIds.length === 1 ? ' differs' : 's differ'} from the ledger: ${failedIds.join(', ')}.`,
      hint: `Run assets --fetch ${failedIds.join(',')} to download again.${moved}`,
    });
  }
  return verified;
}

/** The credits path: --credits-path resolved against the working directory, or <out>/CREDITS.md. */
export function creditsPath(args: ParsedArguments, context: CommandContext): string {
  const given = args.string('credits-path');
  return given === undefined ? join(context.outDir, 'CREDITS.md') : resolve(context.cwd, given);
}

/** The assets command. */
export const command: Command = {
  name: 'assets',
  summary: 'List, download (--fetch <id,id> or --all), verify the installed CC0 assets, or write CREDITS.md (--credits, --credits-path <path>).',
  options: { strings: ['fetch', 'credits-path'], flags: ['list', 'all', 'verify', 'credits'] },
  async run(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
    const fetch = args.string('fetch');
    const all = args.flag('all');
    const verify = args.flag('verify');
    // Naming the path is enough to ask for the file.
    const credits = args.flag('credits') || args.string('credits-path') !== undefined;
    if (args.positionals.length > 0) {
      throw new UsageError(`Unexpected argument ${JSON.stringify(args.positionals[0])}.`, 'assets takes options only; the credits file is named with --credits-path <path>.');
    }
    const list = args.flag('list') || (fetch === undefined && !all && !verify && !credits);

    const ledger = new AssetLedger(assetLedgerPath(context.dataDir));
    ledger.load();
    const artifacts: string[] = [];
    let data: AssetsData = {};
    if (fetch !== undefined || all) {
      const fetched = await fetchEntries(context, ledger, selectEntries(fetch, all));
      artifacts.push(...fetched.map((entry) => entry.path));
      data = { ...data, fetched };
    }
    if (verify) data = { ...data, verified: await verifyInstalled(context, ledger) };
    // After the downloads and the verification, so installed reflects what the command leaves behind.
    if (list) data = { ...data, assets: listAssets(context, ledger) };
    if (credits) {
      const path = creditsPath(args, context);
      ensureDirectory(dirname(path));
      writeFileSync(path, creditsMarkdown(ledger.all()), 'utf8');
      context.log.info(`wrote ${path}`);
      artifacts.push(path);
      data = { ...data, credits: path };
    }
    return { data, artifacts };
  },
};
