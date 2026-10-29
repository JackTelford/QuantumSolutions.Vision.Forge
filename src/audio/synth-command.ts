/**
 * `audio synth`: the one action of the audio command that runs the voice.
 *
 * `audio synth --text "<sentence>" | --script <file.txt> [--voice af_heart]
 * [--fps 30] [--gap 0.35] [--out-dir <dir>]` writes `narration.wav`,
 * `captions.srt`, `narration.json` and one WAV per sentence under
 * `<out>/narration/` (or `--out-dir`). The result's artifacts are the WAV
 * and the SRT, its evidence the JSON, and its data the narration document.
 * Fails closed with `narration-not-installed` before the model is touched
 * and with `voice-unknown` for a voice outside the offered list. The
 * dispatcher in src/cli/commands/audio.ts calls `runSynth` for `synth`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ArgumentSpec, ParsedArguments } from '../cli/arguments.ts';
import type { CommandContext } from '../cli/command.ts';
import type { CommandOutput } from '../cli/result.ts';
import { DataFileError, UsageError, VisionForgeError } from '../errors/vision-forge-error.ts';
import { requireFfmpeg, requireFfprobe } from '../tools/ffmpeg.ts';
import { assertNarrationInstalled } from './kokoro-loader.ts';
import { defaultGapSeconds, narrationFileNames, synthesizeNarration } from './synth.ts';
import type { NarrationDocument } from './synth.ts';
import { defaultVoice, findOfferedVoice, offeredVoices } from './voices.ts';

/** The options `synth` reads; the audio command's option table lists them with the other actions'. */
export const synthOptions: ArgumentSpec = { strings: ['text', 'script', 'voice', 'fps', 'gap', 'out-dir'], flags: [] };

/** The frame rate when --fps is absent. */
export const defaultFps = 30;

/** The voice to use: --voice when it is on the offered list (voices.ts), else voice-unknown with the offered names and grades in the hint. */
export function resolveVoice(requested: string | undefined): string {
  const voice = requested ?? defaultVoice;
  if (findOfferedVoice(voice) !== undefined) return voice;
  throw new VisionForgeError({
    code: 'voice-unknown',
    message: `The voice "${voice}" is not offered.`,
    hint: `Offered voices: ${offeredVoices.map((offered) => `${offered.name} (${offered.grade})`).join(', ')}; the default is ${defaultVoice}. Run audio voices to see them.`,
  });
}

/** The text from --text or the file named by --script (resolved against the working directory); exactly one of the two. */
export function readNarrationText(args: ParsedArguments, cwd: string): string {
  const text = args.string('text');
  const script = args.string('script');
  if (text !== undefined && script !== undefined) throw new UsageError('Pass --text or --script, not both.', 'Use --text "<sentence>" for a short line or --script <file.txt> for a longer one.');
  if (text !== undefined) return text;
  if (script === undefined) throw new UsageError('Missing --text or --script.', 'Pass --text "<sentence>" or --script <file.txt>.');
  const path = resolve(cwd, script);
  try {
    return readFileSync(path, 'utf8');
  } catch (error: unknown) {
    throw new DataFileError(path, error instanceof Error ? error.message : String(error), 'Check the --script path; it is read relative to the working directory.');
  }
}

/** A positive number option, or its default; a usage error names a value at or below zero. */
export function positiveOption(args: ParsedArguments, name: string, fallback: number, allowZero = false): number {
  const value = args.number(name) ?? fallback;
  if (!(allowZero ? value >= 0 : value > 0)) throw new UsageError(`--${name} must be ${allowZero ? 'zero or more' : 'greater than zero'}, not ${String(value)}.`, `Pass --${name} <number>.`);
  return value;
}

/** Runs `audio synth` with the parsed arguments. */
export async function runSynth(context: CommandContext, args: ParsedArguments): Promise<CommandOutput> {
  const text = readNarrationText(args, context.cwd);
  const voice = resolveVoice(args.string('voice'));
  const fps = positiveOption(args, 'fps', defaultFps);
  const gapSeconds = positiveOption(args, 'gap', defaultGapSeconds, true);
  const explicitOut = args.string('out-dir');
  const outDir = explicitOut === undefined ? join(context.outDir, 'narration') : resolve(context.cwd, explicitOut);
  // Before ffmpeg is looked for, so a machine without the component gets the install hint first.
  assertNarrationInstalled(context.dataDir);
  const ffmpegPath = requireFfmpeg();
  const ffprobePath = requireFfprobe();
  context.log.info(`synthesising with ${voice} into ${outDir}`);
  const document: NarrationDocument = await synthesizeNarration({ dataDir: context.dataDir, text, voice, outDir, fps, gapSeconds, runner: context.runner, ffmpegPath, ffprobePath, log: context.log, signal: context.signal, now: context.now });
  return { data: document, artifacts: [document.wavPath, document.srtPath], evidence: [join(outDir, narrationFileNames.json)] };
}
