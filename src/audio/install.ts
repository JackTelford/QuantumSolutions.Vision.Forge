/**
 * `audio install`: the narration component into the data directory (ADR
 * 0007). The template under components/narration is copied to
 * `<data>/narration/`, `npm ci --ignore-scripts` runs there by spawning the
 * running Node with npm-cli.js (the one npm call in the repository; never
 * npm.cmd, never a shell), then the four pinned weight files are downloaded
 * through the allowlisted HttpDownloader, verified by size and SHA-256,
 * recorded in the asset ledger and described in provenance.json beside a
 * license note. Every step is resumable: packages already installed from the
 * same lockfile are kept, a weight file present with the pinned hash is
 * kept, and one with another hash is set aside as `.corrupt` and fetched
 * again. Nothing is fetched or run until the caller confirms (--yes); before
 * that the sizes and the third-party notice are logged and the result says
 * `confirmed: false`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { createAssetDownloader, setAside, sha256File } from '../assets/fetch.ts';
import type { Logger } from '../cli/logger.ts';
import { NpmInstallFailedError, NpmMissingError, WeightsDownloadFailedError } from '../errors/narration-errors.ts';
import { CancelledError, VisionForgeError } from '../errors/vision-forge-error.ts';
import { writeJsonAtomic } from '../fs/atomic-json.ts';
import { AssetLedger, assetLedgerPath } from '../net/asset-ledger.ts';
import type { HttpDownloader } from '../net/http-downloader.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { stderrTail } from '../process/process-runner.ts';
import { npmCiArguments, npmCliCandidates } from '../tools/npm-cli.ts';
import { componentPaths, componentStatus, narrationTemplateDir, sha256OfBytes } from './component.ts';
import type { ComponentPaths } from './component.ts';
import { describeThirdPartyNotices, narrationThirdPartyNotices } from './third-party.ts';
import type { ThirdPartyNotice } from './third-party.ts';
import { kokoroCommit, kokoroLicense, kokoroRepository, kokoroWeightAssetId, kokoroWeightDestination, kokoroWeightFiles, kokoroWeightUrl } from './weights.ts';
import type { PinnedWeightFile } from './weights.ts';

/** The dependency chain's size on win32-x64 (docs/research.md): what the user is told before confirming. */
export const packagesCompressedBytes = 150_105_533;
/** The same chain unpacked under node_modules. */
export const packagesUnpackedBytes = 424_500_506;

/** `npm ci` is killed after this long; below about 20 Mbit/s the download alone takes minutes. */
export const npmTimeoutMs = 600_000;

/** The attribution every weight record carries. */
export const kokoroCredit = 'Kokoro-82M by hexgrad, ONNX export by onnx-community';

/** What installNarration needs; everything after `confirm` is injectable for tests. */
export interface InstallNarrationOptions {
  readonly dataDir: string;
  readonly runner: ProcessRunner;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  /** True when the user passed --yes; otherwise nothing is run or fetched. */
  readonly confirm: boolean;
  /** True to re-hash weight files that are present at the pinned size even when the ledger vouches for them. */
  readonly verify?: boolean;
  /** The pinned files; the real manifest by default. */
  readonly files?: readonly PinnedWeightFile[];
  /** Where each pinned file is fetched from; the Hugging Face resolve URL by default. */
  readonly urlOf?: (file: PinnedWeightFile) => string;
  /** The downloader; one for the production allowlist by default. */
  readonly downloader?: HttpDownloader;
  readonly templateDir?: string;
  /** The Node that runs npm-cli.js; the running one by default. */
  readonly execPath?: string;
  readonly platform?: NodeJS.Platform;
}

/**
 * How a pinned file's hash was established in this run: fetched and hashed
 * by the downloader, re-hashed on disk, taken from the ledger's record, or
 * not looked at because the user has not confirmed yet.
 */
export type WeightVerification = 'downloaded' | 'rehashed' | 'ledger' | 'unchecked';

/** One pinned file after the install. */
export interface InstalledWeight {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  /** False when the file was already present with the pinned hash. */
  readonly downloaded: boolean;
  /** What vouches for the hash; `audio install --yes --verify` turns every `ledger` into `rehashed`. */
  readonly verified: WeightVerification;
}

/** What the command's result carries. */
export interface InstallNarrationResult {
  /** False when the user has not passed --yes; nothing was run or fetched. */
  readonly confirmed: boolean;
  /** The component's state after the command, from the disk. */
  readonly installed: boolean;
  readonly packages: {
    /** Entries of the lockfile's packages map other than the root; npm installs the subset this platform needs. */
    readonly count: number;
    readonly lockfileSha256: string;
    /** True when npm ci ran in this call. */
    readonly installedNow: boolean;
  };
  readonly weights: readonly InstalledWeight[];
  readonly thirdParty: readonly ThirdPartyNotice[];
  /** The provenance file, or null before confirmation. */
  readonly provenancePath: string | null;
  /** What to do next when not confirmed. */
  readonly hint?: string;
}

/** The provenance document written beside the component. */
export interface NarrationProvenance {
  readonly kind: 'narration-provenance';
  readonly version: 1;
  readonly repository: string;
  readonly commit: string;
  readonly license: string;
  readonly licensePath: string;
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
  readonly packages: { readonly count: number; readonly lockfileSha256: string };
  readonly fetchedAt: string;
  readonly nodeVersion: string;
}

interface Template {
  readonly packageJson: Buffer;
  readonly lockfile: Buffer;
  readonly lockfileSha256: string;
  readonly packageCount: number;
}

/** The hint every npm failure carries. */
const npmFailureHint = 'Check the network connection (packages come from registry.npmjs.org) and the free space (about 425 MB), then run audio install --yes again; --verbose shows npm\'s output.';

/** Bytes as megabytes with no decimals, for the sizes the user confirms. */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Reads the template and counts its packages; a template that is not a lockfile v3 is a bug in the repository, not the user's data. */
function readTemplate(templateDir: string): Template {
  const packageJson = readFileSync(join(templateDir, 'package.json'));
  const lockfile = readFileSync(join(templateDir, 'package-lock.json'));
  const parsed = JSON.parse(lockfile.toString('utf8')) as { readonly packages?: Record<string, unknown> };
  const packageCount = Object.keys(parsed.packages ?? {}).filter((key) => key !== '').length;
  return { packageJson, lockfile, lockfileSha256: sha256OfBytes(lockfile), packageCount };
}

/** Writes bytes to a temporary name in the same directory, then renames over the target, so a reader never sees a half-written file. */
function writeFileAtomic(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${process.pid}-${Date.now()}.tmp`);
  writeFileSync(temp, bytes);
  try {
    renameSync(temp, path);
  } catch (error: unknown) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** The first npm-cli.js candidate that exists, else NpmMissingError naming every path tried. */
export function findNpmCli(execPath: string, platform: NodeJS.Platform): string {
  const candidates = npmCliCandidates(execPath, platform);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new NpmMissingError(execPath, candidates);
  return found;
}

/** Logs what --yes would install: the sizes and the third-party notice. */
function describePlan(log: Logger, template: Template, files: readonly PinnedWeightFile[], paths: ComponentPaths): void {
  const weightBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  log.info(`audio install would put the narration component under ${paths.root}:`);
  log.info(`  ${template.packageCount} npm packages (kokoro-js 1.2.1, @huggingface/transformers 3.8.1 and their dependencies): about ${megabytes(packagesCompressedBytes)} to download, ${megabytes(packagesUnpackedBytes)} on disk`);
  log.info(`  ${files.length} model files of ${kokoroRepository} at commit ${kokoroCommit.slice(0, 12)} (${kokoroLicense}): ${megabytes(weightBytes)} to download, verified by SHA-256`);
  log.info('  third-party notice (THIRD-PARTY.md has the full table):');
  for (const line of describeThirdPartyNotices()) log.info(`    ${line}`);
}

/**
 * Copies the template and runs `npm ci` unless the packages are already
 * there from the same lockfile. Returns true when npm ran. The lockfile is
 * copied before npm runs, so a failed install is retried on the next run
 * (the packages are missing) and a changed template reinstalls (the copy
 * differs). A run that was killed (the timeout, Ctrl+C, a power loss) is
 * retried too: componentStatus counts the packages as present only with
 * npm's hidden lockfile, which npm writes last.
 */
async function installPackages(options: InstallNarrationOptions, template: Template, paths: ComponentPaths, files: readonly PinnedWeightFile[], templateDir: string): Promise<boolean> {
  const { log, runner, signal } = options;
  const before = componentStatus(options.dataDir, files, templateDir);
  if (before.packagesPresent && before.lockfileMatches) {
    log.info(`packages: already installed under ${paths.nodeModules} from this lockfile`);
    return false;
  }
  writeFileAtomic(paths.packageJson, template.packageJson);
  writeFileAtomic(paths.lockfile, template.lockfile);
  const execPath = options.execPath ?? process.execPath;
  const npmCli = findNpmCli(execPath, options.platform ?? process.platform);
  const args = npmCiArguments(npmCli);
  log.info(`packages: running ${execPath} ${args.join(' ')} in ${paths.root} (up to ${Math.round(npmTimeoutMs / 60_000)} minutes)`);
  // The update notifier would print to stderr and try the network on its own; nothing else of npm's behaviour is changed.
  const result = await runner.run({ label: 'npm', executable: execPath, args, cwd: paths.root, env: { npm_config_update_notifier: 'false' }, timeoutMs: npmTimeoutMs }, signal);
  if (result.timedOut) throw new NpmInstallFailedError(`npm ci did not finish within ${Math.round(npmTimeoutMs / 1000)} s and was stopped.`, npmFailureHint);
  if (result.exitCode !== 0) {
    const tail = stderrTail(result.stderr);
    throw new NpmInstallFailedError(`npm ci exited with code ${result.exitCode === null ? 'none (killed)' : String(result.exitCode)}.${tail.length > 0 ? ` Last output: ${tail}` : ''}`, npmFailureHint);
  }
  log.debug(`npm: ${stderrTail(result.stdout + result.stderr, 200)}`);
  const after = componentStatus(options.dataDir, files, templateDir);
  if (!after.packagesPresent) throw new NpmInstallFailedError(`npm ci exited 0 but ${after.missing[0] ?? 'the packages are missing'}.`, npmFailureHint);
  log.info(`packages: installed ${template.packageCount} lockfile entries in ${(result.elapsedMs / 1000).toFixed(1)} s`);
  return true;
}

/** The file's path relative to the data directory with forward slashes, as the ledger records files. */
function ledgerFile(dataDir: string, destination: string): string {
  return relative(dataDir, destination).split(sep).join('/');
}

/** Records a verified file in the ledger and saves it. */
function recordWeight(ledger: AssetLedger, dataDir: string, file: PinnedWeightFile, url: string, finalUrl: string, fetchedAt: string): void {
  ledger.record({
    id: kokoroWeightAssetId(file),
    source: url,
    finalUrl,
    license: kokoroLicense,
    bytes: file.bytes,
    sha256: file.sha256,
    fetchedAt,
    credit: kokoroCredit,
    files: [ledgerFile(dataDir, kokoroWeightDestination(dataDir, file))],
  });
  ledger.save();
}

/**
 * One pinned file: kept when it is present at the pinned size and either
 * the ledger vouches for its hash (and --verify was not given) or a re-hash
 * matches; set aside as `.corrupt` and downloaded again otherwise.
 */
async function installWeight(options: InstallNarrationOptions, ledger: AssetLedger, downloader: HttpDownloader, file: PinnedWeightFile, url: string): Promise<InstalledWeight> {
  const { dataDir, log, signal } = options;
  const destination = kokoroWeightDestination(dataDir, file);
  const id = kokoroWeightAssetId(file);
  if (existsSync(destination)) {
    const size = statSync(destination).size;
    if (size === file.bytes) {
      const record = ledger.find(id);
      if (options.verify !== true && record !== undefined && record.sha256 === file.sha256) {
        log.info(`${file.path}: already installed (${size} bytes, recorded in the ledger)`);
        return { path: file.path, bytes: size, sha256: file.sha256, downloaded: false, verified: 'ledger' };
      }
      const actual = await sha256File(destination);
      if (actual === file.sha256) {
        // The ledger lost the record, or --verify asked for a re-hash: the file is right, so the record is written without
        // a download; nothing was fetched, so the pinned URL stands in for the final one.
        if (record === undefined || record.sha256 !== file.sha256) recordWeight(ledger, dataDir, file, url, url, options.now().toISOString());
        log.info(`${file.path}: already installed, sha256 verified`);
        return { path: file.path, bytes: size, sha256: actual, downloaded: false, verified: 'rehashed' };
      }
      log.warn(`${file.path}: sha256 ${actual} differs from the pinned ${file.sha256}; moved it to ${setAside(destination) ?? destination} and downloading again`);
    } else {
      log.warn(`${file.path}: ${size} bytes on disk, not the pinned ${file.bytes}; moved it to ${setAside(destination) ?? destination} and downloading again`);
    }
  }
  log.info(`${file.path}: downloading ${file.bytes < 1_000_000 ? `${file.bytes} bytes` : megabytes(file.bytes)} from ${url}`);
  try {
    const result = await downloader.download({ url, destination, expectedBytes: file.bytes, sha256: file.sha256, label: file.path }, signal);
    recordWeight(ledger, dataDir, file, url, result.finalUrl, options.now().toISOString());
    log.info(`${file.path}: downloaded ${result.bytes} bytes from ${result.finalUrl}, sha256 verified`);
    return { path: file.path, bytes: result.bytes, sha256: result.sha256, downloaded: true, verified: 'downloaded' };
  } catch (error: unknown) {
    if (error instanceof CancelledError) throw error;
    if (error instanceof VisionForgeError) throw new WeightsDownloadFailedError(file.path, error);
    throw error;
  }
}

/**
 * The license note beside the weights. The model repository has no LICENSE
 * file at the pinned commit (checked 2026-10-29: the tree holds README.md,
 * config.json, the tokenizer files, onnx/ and voices/; /resolve/<commit>/LICENSE
 * answers 404), so instead of copying one this note names the Apache-2.0
 * license the model card declares and the repository it came from.
 */
export function licenseText(): string {
  return [
    'Kokoro-82M-v1.0-ONNX model weights',
    `Repository: https://huggingface.co/${kokoroRepository}`,
    `Commit: ${kokoroCommit}`,
    `License: ${kokoroLicense} (https://www.apache.org/licenses/LICENSE-2.0)`,
    `Credit: ${kokoroCredit}`,
    '',
    'The repository carries no LICENSE file at this commit; its model card declares Apache-2.0. Written by audio install.',
    '',
  ].join('\n');
}

/** The most recent fetchedAt the ledger holds for the files, so a run that fetched nothing keeps the provenance's date; the clock only when no record exists. */
function latestFetch(ledger: AssetLedger, files: readonly PinnedWeightFile[], now: Date): string {
  const stamps = files.map((file) => ledger.find(kokoroWeightAssetId(file))?.fetchedAt).filter((stamp): stamp is string => stamp !== undefined).sort();
  return stamps[stamps.length - 1] ?? now.toISOString();
}

/** Installs the component; see the file comment for what is run, fetched, kept and written. */
export async function installNarration(options: InstallNarrationOptions): Promise<InstallNarrationResult> {
  const files = options.files ?? kokoroWeightFiles;
  const urlOf = options.urlOf ?? kokoroWeightUrl;
  const templateDir = options.templateDir ?? narrationTemplateDir;
  const paths = componentPaths(options.dataDir);
  const template = readTemplate(templateDir);
  const packages = { count: template.packageCount, lockfileSha256: template.lockfileSha256 };
  describePlan(options.log, template, files, paths);
  if (!options.confirm) {
    const hint = 'Run again with --yes to install.';
    options.log.info(hint);
    return {
      confirmed: false,
      installed: componentStatus(options.dataDir, files, templateDir).installed,
      packages: { ...packages, installedNow: false },
      weights: files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256, downloaded: false, verified: 'unchecked' })),
      thirdParty: narrationThirdPartyNotices,
      provenancePath: null,
      hint,
    };
  }

  const installedNow = await installPackages(options, template, paths, files, templateDir);
  const ledger = new AssetLedger(assetLedgerPath(options.dataDir));
  ledger.load();
  const downloader = options.downloader ?? createAssetDownloader(options.log, options.now);
  const weights: InstalledWeight[] = [];
  for (const file of files) {
    // Ctrl+C between files stops here; the downloader honours the signal inside a file.
    if (options.signal.aborted) throw new CancelledError();
    weights.push(await installWeight(options, ledger, downloader, file, urlOf(file)));
  }

  writeFileAtomic(paths.license, Buffer.from(licenseText(), 'utf8'));
  const provenance: NarrationProvenance = {
    kind: 'narration-provenance',
    version: 1,
    repository: kokoroRepository,
    commit: kokoroCommit,
    license: kokoroLicense,
    licensePath: paths.license,
    files: weights.map((weight) => ({ path: weight.path, bytes: weight.bytes, sha256: weight.sha256 })),
    packages,
    fetchedAt: latestFetch(ledger, files, options.now()),
    nodeVersion: process.version,
  };
  writeJsonAtomic(paths.provenance, provenance);
  options.log.info(`wrote ${paths.provenance}`);
  const installed = componentStatus(options.dataDir, files, templateDir).installed;
  return { confirmed: true, installed, packages: { ...packages, installedNow }, weights, thirdParty: narrationThirdPartyNotices, provenancePath: paths.provenance };
}
