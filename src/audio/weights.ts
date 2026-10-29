/**
 * The pinned Kokoro-82M weights of ADR 0007: four files of one commit of
 * the onnx-community repository, each with its byte size and SHA-256, so
 * `audio install` downloads exactly these through the allowlisted
 * downloader and the loader reads them from the data directory with
 * remote models disallowed. The layout under the models directory is the
 * one transformers.js expects for a local model id:
 * `<models>/<repo>/<file>`.
 */
import { join } from 'node:path';

/** One pinned file of the model repository. */
export interface PinnedWeightFile {
  /** Path inside the repository, forward slashes. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** The repository id transformers.js resolves, and the data the pins came from (docs/research.md, 2026-10-26). */
export const kokoroRepository = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** The commit every URL names: the pins mean nothing against a moving branch. */
export const kokoroCommit = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';

/** The model repository's license. */
export const kokoroLicense = 'Apache-2.0';

/** The four files the q8 CPU path loads, verified by size and SHA-256 (the three small ones hashed 2026-10-29). */
export const kokoroWeightFiles: readonly PinnedWeightFile[] = [
  { path: 'onnx/model_quantized.onnx', bytes: 92_361_116, sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478' },
  { path: 'config.json', bytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { path: 'tokenizer.json', bytes: 3_497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { path: 'tokenizer_config.json', bytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
];

/** The bytes of every pinned file together, for the size `audio install` prints before downloading. */
export const kokoroWeightBytes: number = kokoroWeightFiles.reduce((sum, file) => sum + file.bytes, 0);

/** The pinned `resolve` URL of a file: host huggingface.co, which redirects to a `*.hf.co` CDN host the allowlist admits. */
export function kokoroWeightUrl(file: PinnedWeightFile): string {
  return `https://huggingface.co/${kokoroRepository}/resolve/${kokoroCommit}/${file.path}`;
}

/** The narration component's root under the data directory. */
export function narrationDir(dataDir: string): string {
  return join(dataDir, 'narration');
}

/** The models directory the loader points `env.localModelPath` at. */
export function narrationModelsDir(dataDir: string): string {
  return join(narrationDir(dataDir), 'models');
}

/** Where a pinned file lives on disk: the transformers.js local layout, `<models>/<repository>/<path>`. */
export function kokoroWeightDestination(dataDir: string, file: PinnedWeightFile): string {
  return join(narrationModelsDir(dataDir), ...kokoroRepository.split('/'), ...file.path.split('/'));
}

/** The ledger id of a pinned file, for example `narration:onnx/model_quantized.onnx`. */
export function kokoroWeightAssetId(file: PinnedWeightFile): string {
  return `narration:${file.path}`;
}
