/**
 * One narration from text (ADR 0007): the text is normalized and cut into
 * sentences in TypeScript, each sentence is synthesised in order and kept
 * as its own WAV, the sentences are joined with a gap of silence into
 * `narration.raw.wav`, the per-sentence timings become frame events and
 * `captions.srt`, the raw file is normalized in two passes to -16 LUFS and
 * -1.5 dBTP into `narration.wav`, measured back with ebur128, and
 * everything is recorded in `narration.json`.
 *
 * Deterministic given the same text, voice and weights: the samples are a
 * CPU inference, so durations and loudness repeat; the QA compares those
 * and never bytes (ADR 0007). The handle (or its loader) is injectable so
 * the tests run without the model. A sentence the voice cannot read fails
 * with `narration-synthesis-failed` naming the sentence.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../cli/logger.ts';
import { CancelledError, UsageError, VisionForgeError } from '../errors/vision-forge-error.ts';
import { writeJsonAtomic } from '../fs/atomic-json.ts';
import type { ProcessRunner } from '../process/process-runner.ts';
import { judgeLoudness, judgeTruePeak, measureLoudness } from '../qa/audio-checks.ts';
import { currentMappedLibraries, isDirectMlMapped } from './directml-check.ts';
import type { KokoroHandle, SynthesizedAudio } from './kokoro-loader.ts';
import { loadKokoro } from './kokoro-loader.ts';
import { narrationLoudnessTarget, narrationTruePeakCeiling, normalizeNarrationLoudness } from './loudness.ts';
import { normalizeNarrationText, splitSentences } from './normalize-text.ts';
import { formatSrt } from './srt.ts';
import { gapSampleCount, sentenceTimings } from './timing.ts';
import { joinWithSilence, narrationSampleRate, wavBytes } from './wav.ts';

/** The silence between sentences when the caller names none, in seconds. */
export const defaultGapSeconds = 0.35;

/** What synthesizeNarration needs. */
export interface SynthesizeOptions {
  readonly dataDir: string;
  readonly text: string;
  readonly voice: string;
  /** The directory the files are written into; created. */
  readonly outDir: string;
  readonly fps: number;
  readonly runner: ProcessRunner;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly gapSeconds?: number;
  readonly now: () => Date;
  /** A voice the caller already loaded; it stays open afterwards, the caller disposes it. When absent, `loadVoice` loads one for this narration alone and disposes it at the end. */
  readonly handle?: KokoroHandle;
  /** Loads the voice from the data directory when no handle is supplied; defaults to loadKokoro. Tests pass a fake. */
  readonly loadVoice?: (dataDir: string) => Promise<KokoroHandle>;
  /** The libraries mapped into the process, read after the first synthesis; defaults to Node's diagnostic report. */
  readonly mappedLibraries?: () => readonly string[];
  readonly platform?: NodeJS.Platform;
}

/** One sentence as narration.json records it. */
export interface NarrationSentence {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly startFrame: number;
  readonly endFrame: number;
}

/** The narration document, `narration.json`. */
export interface NarrationDocument {
  readonly kind: 'narration';
  readonly version: 1;
  readonly voice: string;
  /** The text as normalized, which is what the voice read. */
  readonly text: string;
  readonly sentences: readonly NarrationSentence[];
  readonly totalFrames: number;
  readonly fps: number;
  readonly sampleRate: number;
  readonly wavPath: string;
  readonly srtPath: string;
  readonly loudness: {
    readonly integratedLufs: number;
    readonly truePeakDbtp: number;
  };
  /** Wall-clock seconds spent in the model, model load excluded. */
  readonly synthesisSeconds: number;
  /** True when DirectML.dll was mapped into the process after synthesis (ADR 0007 expects false on the CPU path); false off Windows. */
  readonly directMlMapped: boolean;
}

/** The file names under the output directory. */
export const narrationFileNames = {
  raw: 'narration.raw.wav',
  wav: 'narration.wav',
  srt: 'captions.srt',
  json: 'narration.json',
  sentences: 'sentences',
} as const;

/** The WAV of sentence `index` (counted from 0) under the output directory: sentences/sentence-01.wav. */
export function sentenceWavPath(outDir: string, index: number): string {
  return join(outDir, narrationFileNames.sentences, `sentence-${String(index + 1).padStart(2, '0')}.wav`);
}

/** Synthesises the narration into `outDir` and returns the document it wrote. */
export async function synthesizeNarration(options: SynthesizeOptions): Promise<NarrationDocument> {
  const text = normalizeNarrationText(options.text);
  const sentences = splitSentences(text);
  if (sentences.length === 0) throw new UsageError('The narration text has no sentences.', 'Pass --text "<sentence>" or --script <file.txt> with at least one sentence.');
  if (!(options.fps > 0)) throw new UsageError(`--fps must be a positive frame rate, not ${String(options.fps)}.`, 'Pass --fps 24, 25, 30 or 60.');
  const gapSeconds = options.gapSeconds ?? defaultGapSeconds;
  mkdirSync(join(options.outDir, narrationFileNames.sentences), { recursive: true });

  // Only a voice loaded here is disposed here; a supplied one belongs to the caller, who may narrate again with it.
  const owned = options.handle === undefined;
  const handle = options.handle ?? (await (options.loadVoice ?? loadKokoro)(options.dataDir));
  let parts: Float32Array[];
  let synthesisSeconds: number;
  let libraries: readonly string[];
  try {
    ({ parts, synthesisSeconds } = await synthesizeSentences(handle, sentences, options));
    // Read while the onnxruntime sessions are still alive: the question is what the live session loaded (ADR 0007).
    libraries = (options.mappedLibraries ?? currentMappedLibraries)();
  } finally {
    if (owned) await handle.dispose();
  }
  const directMlMapped = (options.platform ?? process.platform) === 'win32' && isDirectMlMapped(libraries);
  options.log.info(`DirectML.dll mapped into the process: ${directMlMapped ? 'yes' : 'no'}`);

  // Every sentence came back at narrationSampleRate (synthesizeSentences holds them to it), the rate narration.wav is pinned to.
  const sampleRate = narrationSampleRate;
  const rawPath = join(options.outDir, narrationFileNames.raw);
  writeFileSync(rawPath, wavBytes(joinWithSilence(parts, gapSampleCount(gapSeconds, sampleRate)), sampleRate));
  const timing = sentenceTimings(parts.map((part) => part.length), sampleRate, gapSeconds, options.fps);
  const srtPath = join(options.outDir, narrationFileNames.srt);
  writeFileSync(srtPath, formatSrt(timing.sentences.map((sentence, index) => ({ startSeconds: sentence.startSeconds, endSeconds: sentence.endSeconds, text: sentences[index] ?? '' }))), 'utf8');

  const wavPath = join(options.outDir, narrationFileNames.wav);
  const measured = await normalizeNarrationLoudness({ runner: options.runner, ffmpegPath: options.ffmpegPath, input: rawPath, output: wavPath, signal: options.signal });
  options.log.debug(`raw loudness ${measured.inputI} LUFS, true peak ${measured.inputTp} dBTP`);
  const loudness = await verifyLoudness(options, wavPath);
  options.log.info(`loudness ${loudness.integratedLufs.toFixed(1)} LUFS, true peak ${loudness.truePeakDbtp.toFixed(1)} dBTP, ${timing.totalSeconds.toFixed(2)} s, ${String(timing.totalFrames)} frames at ${String(options.fps)} fps`);

  const document: NarrationDocument = {
    kind: 'narration',
    version: 1,
    voice: options.voice,
    text,
    sentences: timing.sentences.map((sentence, index) => ({ text: sentences[index] ?? '', ...sentence })),
    totalFrames: timing.totalFrames,
    fps: options.fps,
    sampleRate,
    wavPath,
    srtPath,
    loudness,
    synthesisSeconds,
    directMlMapped,
  };
  writeJsonAtomic(join(options.outDir, narrationFileNames.json), document);
  return document;
}

interface SynthesizedSentences {
  readonly parts: Float32Array[];
  readonly synthesisSeconds: number;
}

/** Runs the voice over the sentences in order, writes each one's WAV and logs one line per sentence; every sentence must come back at narrationSampleRate, the rate the normalized file is pinned to. */
async function synthesizeSentences(handle: KokoroHandle, sentences: readonly string[], options: SynthesizeOptions): Promise<SynthesizedSentences> {
  const parts: Float32Array[] = [];
  let synthesisMs = 0;
  for (const [index, sentence] of sentences.entries()) {
    // The model runs for seconds per sentence; Ctrl+C between sentences must stop here.
    if (options.signal.aborted) throw new CancelledError();
    const started = options.now().getTime();
    const audio = await synthesizeSentence(handle, sentence, index, options.voice);
    synthesisMs += options.now().getTime() - started;
    if (audio.sampleRate !== narrationSampleRate) throw new VisionForgeError({ code: 'narration-sample-rate', message: `Sentence ${String(index + 1)} came back at ${String(audio.sampleRate)} Hz; the voice model synthesises at ${String(narrationSampleRate)} Hz.`, hint: 'The voice model changed its rate, which it never should; reinstall the component with audio install --yes.' });
    writeFileSync(sentenceWavPath(options.outDir, index), wavBytes(audio.samples, audio.sampleRate));
    parts.push(audio.samples);
    options.log.info(`sentence ${String(index + 1)}: ${(audio.samples.length / audio.sampleRate).toFixed(2)} s: ${sentence}`);
  }
  return { parts, synthesisSeconds: synthesisMs / 1000 };
}

/** One sentence through the voice; a library error becomes narration-synthesis-failed naming the sentence, while a VisionForgeError (a cancellation) passes through as it is. */
async function synthesizeSentence(handle: KokoroHandle, sentence: string, index: number, voice: string): Promise<SynthesizedAudio> {
  try {
    return await handle.synthesize(sentence, voice);
  } catch (cause: unknown) {
    if (cause instanceof VisionForgeError) throw cause;
    throw new VisionForgeError({
      code: 'narration-synthesis-failed',
      message: `The voice could not read sentence ${String(index + 1)} ("${sentence}"): ${cause instanceof Error ? cause.message : String(cause)}`,
      hint: 'Run audio install --verify to re-hash the pinned files, or audio install --yes to reinstall the component; if only this sentence fails, reword it.',
      cause,
    });
  }
}

/** Measures the normalized file with ebur128 and holds it to the targets (within 1 LU, at or under the ceiling), else narration-loudness names the miss. */
async function verifyLoudness(options: SynthesizeOptions, wavPath: string): Promise<NarrationDocument['loudness']> {
  const summary = await measureLoudness(options.runner, options.ffmpegPath, options.ffprobePath, wavPath, options.signal);
  const checks = [judgeLoudness(summary, narrationLoudnessTarget), judgeTruePeak(summary, narrationTruePeakCeiling)];
  const failed = checks.filter((check) => !check.ok);
  if (summary === undefined || failed.length > 0) {
    throw new VisionForgeError({
      code: 'narration-loudness',
      message: `The normalized narration missed its loudness target: ${failed.map((check) => check.detail).join('; ') || 'the file has no audio stream'}.`,
      hint: `The raw file is kept at ${join(options.outDir, narrationFileNames.raw)}; run ffmpeg -af ebur128 on it by hand, or try another voice.`,
    });
  }
  return { integratedLufs: summary.integrated, truePeakDbtp: summary.truePeak };
}
