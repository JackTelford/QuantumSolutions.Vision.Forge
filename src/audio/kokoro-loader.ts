/**
 * The voice model's loader (ADR 0007): `kokoro-js` and
 * `@huggingface/transformers` are not dependencies of the plugin, so they
 * are imported at run time from `<data>/narration/node_modules` by absolute
 * file URL (never a bare specifier: the plugin has no such package), after
 * transformers.js is told to read the four pinned files from the local
 * layout and nothing else (`allowRemoteModels = false`). A missing
 * component fails closed with `narration-not-installed` before any import;
 * a component that is there but will not load (the status check reads the
 * weights by size only, so wrong bytes at the right size, a voice file that
 * is gone, a native binding without its runtime) fails with
 * `narration-load-failed` and the library's own sentence. The two packages
 * are typed through the small interfaces below, which declare only the
 * members this file calls.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NarrationNotInstalledError } from '../errors/narration-errors.ts';
import { VisionForgeError } from '../errors/vision-forge-error.ts';
import { componentStatus } from './component.ts';
import { kokoroRepository, narrationDir, narrationModelsDir } from './weights.ts';

/** Synthesised samples: 32-bit floats in [-1, 1] at the rate the model runs at. */
export interface SynthesizedAudio {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

/** The loaded voice: synthesises one sentence at a time and frees the model when done. */
export interface KokoroHandle {
  synthesize(text: string, voice: string): Promise<SynthesizedAudio>;
  dispose(): Promise<void>;
}

/** The entry points the loader imports, relative to the component's node_modules (the versions are pinned by the component's lockfile). */
export const transformersEntry = join('@huggingface', 'transformers', 'dist', 'transformers.node.mjs');

/** kokoro-js 1.2.1's "node" import target. */
export const kokoroEntry = join('kokoro-js', 'dist', 'kokoro.js');

/** The `env` fields of transformers.js the loader sets. */
interface TransformersEnv {
  localModelPath: string;
  cacheDir: string;
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
}

interface TransformersModule {
  readonly env: TransformersEnv;
}

/** What `KokoroTTS.generate` resolves to: transformers.js's RawAudio. */
interface RawAudioLike {
  readonly audio: Float32Array;
  readonly sampling_rate: number;
}

interface KokoroTtsInstance {
  generate(text: string, options: { readonly voice: string }): Promise<RawAudioLike>;
  /** The transformers.js model, whose sessions can be released. */
  readonly model?: { dispose?: () => Promise<void> };
}

interface KokoroModule {
  readonly KokoroTTS: {
    from_pretrained(repository: string, options: { readonly dtype: string; readonly device: string }): Promise<KokoroTtsInstance>;
  };
}

/** Throws narration-not-installed naming what `componentStatus` found wanting (the packages, the lockfile, every pinned file at its byte size). */
export function assertNarrationInstalled(dataDir: string): void {
  const status = componentStatus(dataDir);
  if (!status.installed) throw new NarrationNotInstalledError(status.missing);
}

/**
 * Loads the voice from the data directory: imports both packages by file
 * URL, points transformers.js at the local models directory with remote
 * models disallowed, then loads the q8 model on the CPU. The handle's
 * samples are a CPU inference: the same text, voice and weights give the
 * same durations and loudness on every run, and QA compares those, never
 * bytes (ADR 0007).
 */
export async function loadKokoro(dataDir: string): Promise<KokoroHandle> {
  assertNarrationInstalled(dataDir);
  const nodeModules = join(narrationDir(dataDir), 'node_modules');
  const modelsDir = narrationModelsDir(dataDir);
  let tts: KokoroTtsInstance;
  try {
    // A Windows path is not a valid ESM specifier ("c:" reads as a scheme); a file URL is.
    const transformers = (await import(pathToFileURL(join(nodeModules, transformersEntry)).href)) as unknown as TransformersModule;
    transformers.env.localModelPath = modelsDir;
    transformers.env.cacheDir = modelsDir;
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    // kokoro-js resolves its own bare "@huggingface/transformers" from the same node_modules, so both share one env.
    const kokoro = (await import(pathToFileURL(join(nodeModules, kokoroEntry)).href)) as unknown as KokoroModule;
    tts = await kokoro.KokoroTTS.from_pretrained(kokoroRepository, { dtype: 'q8', device: 'cpu' });
  } catch (cause: unknown) {
    throw new VisionForgeError({
      code: 'narration-load-failed',
      message: `The voice model under ${modelsDir} did not load: ${cause instanceof Error ? cause.message : String(cause)}`,
      hint: 'Run audio install --verify to re-hash the pinned files, or audio install --yes to reinstall the component.',
      cause,
    });
  }
  return {
    async synthesize(text: string, voice: string): Promise<SynthesizedAudio> {
      const audio = await tts.generate(text, { voice });
      return { samples: audio.audio, sampleRate: audio.sampling_rate };
    },
    async dispose(): Promise<void> {
      // kokoro-js has no dispose of its own; the transformers.js model releases its onnxruntime sessions.
      await tts.model?.dispose?.();
    },
  };
}
