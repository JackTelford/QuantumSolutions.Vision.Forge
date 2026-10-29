/**
 * Where the narration component lives under the data directory and what is
 * there, from the disk alone (ADR 0007): no npm, no network. The component
 * is installed when both packages' package.json files exist under
 * node_modules together with npm's hidden lockfile, the copied lockfile
 * equals the template byte for byte, and every pinned weight file exists
 * with its exact byte size. The SHA-256 of the weights is not checked here
 * (92 MB is a moment, not nothing); `audio install --verify` re-hashes them.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { kokoroRepository, kokoroWeightDestination, kokoroWeightFiles, narrationDir, narrationModelsDir } from './weights.ts';
import type { PinnedWeightFile } from './weights.ts';

/** The template `audio install` copies: components/narration under the repository root. */
export const narrationTemplateDir: string = resolve(import.meta.dirname, '..', '..', 'components', 'narration');

/** The two packages the loader imports; both must be present for the component to count as installed. */
export const narrationPackages: readonly string[] = ['kokoro-js', '@huggingface/transformers'];

/** The files and directories of the component under one data directory. */
export interface ComponentPaths {
  readonly root: string;
  readonly packageJson: string;
  readonly lockfile: string;
  readonly nodeModules: string;
  /**
   * node_modules/.package-lock.json, which npm writes last, after every
   * package is unpacked. `npm ci` empties node_modules first, so this file
   * exists only when the last run finished; without it the two package.json
   * markers can stand beside a half-extracted onnxruntime.
   */
  readonly hiddenLockfile: string;
  readonly models: string;
  /** The model repository's folder under models, where the weights and the license copy live. */
  readonly modelDir: string;
  readonly provenance: string;
  readonly license: string;
}

/** The paths of the component under a data directory. */
export function componentPaths(dataDir: string): ComponentPaths {
  const root = narrationDir(dataDir);
  const models = narrationModelsDir(dataDir);
  const modelDir = join(models, ...kokoroRepository.split('/'));
  const nodeModules = join(root, 'node_modules');
  return {
    root,
    packageJson: join(root, 'package.json'),
    lockfile: join(root, 'package-lock.json'),
    nodeModules,
    hiddenLockfile: join(nodeModules, '.package-lock.json'),
    models,
    modelDir,
    provenance: join(root, 'provenance.json'),
    license: join(modelDir, 'LICENSE.txt'),
  };
}

/** The package.json of one of the component's packages under node_modules. */
export function packageJsonPath(dataDir: string, packageName: string): string {
  return join(componentPaths(dataDir).nodeModules, ...packageName.split('/'), 'package.json');
}

/** One pinned weight file as it stands on disk. */
export interface WeightPresence {
  readonly path: string;
  readonly expectedBytes: number;
  /** The size on disk, or null when the file is absent. */
  readonly bytes: number | null;
  /** True when the file exists at exactly the pinned size. */
  readonly bytesMatched: boolean;
}

/** What componentStatus found. */
export interface ComponentStatus {
  /** True only when everything below is in place. */
  readonly installed: boolean;
  /** True when every package's package.json exists under node_modules and npm's hidden lockfile says the last npm ci finished. */
  readonly packagesPresent: boolean;
  /** SHA-256 of the copied lockfile, or null when there is none. */
  readonly lockfileHash: string | null;
  /** True when the copied lockfile equals the template byte for byte. */
  readonly lockfileMatches: boolean;
  readonly weightsPresent: readonly WeightPresence[];
  /** One sentence per thing wanting; empty when installed. */
  readonly missing: readonly string[];
}

/** SHA-256 of bytes held in memory, for the lockfile (under 50 KB); the weights go through the streaming sha256File. */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The size of a regular file, or null when it does not exist. */
function fileSize(path: string): number | null {
  if (!existsSync(path)) return null;
  const stats = statSync(path);
  return stats.isFile() ? stats.size : null;
}

/** Reads the component's state from the disk; `files` and `templateDir` are injectable for tests. */
export function componentStatus(dataDir: string, files: readonly PinnedWeightFile[] = kokoroWeightFiles, templateDir: string = narrationTemplateDir): ComponentStatus {
  const paths = componentPaths(dataDir);
  const missing: string[] = [];

  const absentPackages = narrationPackages.filter((name) => !existsSync(packageJsonPath(dataDir, name)));
  const npmFinished = fileSize(paths.hiddenLockfile) !== null;
  const packagesPresent = absentPackages.length === 0 && npmFinished;
  if (absentPackages.length > 0) missing.push(`the package${absentPackages.length === 1 ? '' : 's'} ${absentPackages.join(', ')} ${absentPackages.length === 1 ? 'is' : 'are'} not under ${paths.nodeModules}`);
  else if (!npmFinished) missing.push(`${paths.hiddenLockfile} does not exist, so the last npm ci did not finish`);

  let lockfileHash: string | null = null;
  let lockfileMatches = false;
  if (fileSize(paths.lockfile) === null) {
    missing.push(`${paths.lockfile} does not exist`);
  } else {
    const copied = readFileSync(paths.lockfile);
    lockfileHash = sha256OfBytes(copied);
    // A byte comparison, not a hash comparison: the template is right here and the question is whether this copy is it.
    lockfileMatches = copied.equals(readFileSync(join(templateDir, 'package-lock.json')));
    if (!lockfileMatches) missing.push(`${paths.lockfile} differs from the template ${join(templateDir, 'package-lock.json')}`);
  }

  const weightsPresent = files.map((file): WeightPresence => {
    const bytes = fileSize(kokoroWeightDestination(dataDir, file));
    return { path: file.path, expectedBytes: file.bytes, bytes, bytesMatched: bytes === file.bytes };
  });
  for (const weight of weightsPresent) {
    if (weight.bytes === null) missing.push(`the model file ${weight.path} is not under ${paths.modelDir}`);
    else if (!weight.bytesMatched) missing.push(`the model file ${weight.path} is ${weight.bytes} bytes, not the pinned ${weight.expectedBytes}`);
  }

  return { installed: missing.length === 0, packagesPresent, lockfileHash, lockfileMatches, weightsPresent, missing };
}
