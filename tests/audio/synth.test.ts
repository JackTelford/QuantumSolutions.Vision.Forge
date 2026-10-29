import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { parseArguments } from '../../src/cli/arguments.ts';
import type { CommandContext } from '../../src/cli/command.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import type { KokoroHandle, SynthesizedAudio } from '../../src/audio/kokoro-loader.ts';
import { assertNarrationInstalled } from '../../src/audio/kokoro-loader.ts';
import { narrationLoudnessTarget, narrationTruePeakCeiling } from '../../src/audio/loudness.ts';
import { defaultFps, positiveOption, readNarrationText, resolveVoice, runSynth, synthOptions } from '../../src/audio/synth-command.ts';
import { defaultGapSeconds, narrationFileNames, sentenceWavPath, synthesizeNarration } from '../../src/audio/synth.ts';
import type { SynthesizeOptions } from '../../src/audio/synth.ts';
import { defaultVoice, offeredVoices } from '../../src/audio/voices.ts';
import { narrationSampleRate, parseWavHeader, sineSamples, wavHeaderBytes } from '../../src/audio/wav.ts';
import { NarrationNotInstalledError } from '../../src/errors/narration-errors.ts';
import { CancelledError, UsageError, VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { measureLoudness } from '../../src/qa/audio-checks.ts';
import { probeAudio } from '../../src/qa/probe.ts';
import { findFfmpeg, findFfprobe } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;
const text = 'The bottle holds 500 ml. Made by hand, since 1998.';
const sentenceSeconds = [1, 0.5];

/** A voice that returns a sine of a fixed length per sentence and records what it was asked. */
class FakeKokoro implements KokoroHandle {
  readonly calls: { readonly text: string; readonly voice: string }[] = [];
  disposed = 0;
  private readonly rate: number;

  constructor(rate = narrationSampleRate) {
    this.rate = rate;
  }

  synthesize(sentence: string, voice: string): Promise<SynthesizedAudio> {
    this.calls.push({ text: sentence, voice });
    const seconds = sentenceSeconds[this.calls.length - 1] ?? 0.25;
    return Promise.resolve({ samples: sineSamples(440, seconds, this.rate, 0.3), sampleRate: this.rate });
  }

  dispose(): Promise<void> {
    this.disposed += 1;
    return Promise.resolve();
  }
}

const analysisStderr = '[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-26.53",\n\t"input_tp" : "-19.56",\n\t"input_lra" : "0.40",\n\t"input_thresh" : "-36.53",\n\t"output_i" : "-15.61",\n\t"output_tp" : "-8.78",\n\t"output_lra" : "0.00",\n\t"output_thresh" : "-25.61",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "-0.39"\n}\n';
const probeJson = JSON.stringify({ streams: [{ codec_name: 'pcm_s16le', sample_rate: '24000', channels: 1 }] });
const ebur128Summary = (integrated: number, peak: number): string => `[Parsed_ebur128_0 @ 1] Summary:\n\n  Integrated loudness:\n    I:         ${integrated.toFixed(1)} LUFS\n    Threshold: -26.0 LUFS\n\n  True peak:\n    Peak:      ${peak.toFixed(1)} dBFS\n`;

/** Scripts the four program runs of one synthesis: loudnorm measure, loudnorm apply (copies the raw file), ffprobe, ebur128. */
function scriptedFfmpeg(integrated = -16.2, peak = -2.0): FakeProcessRunner {
  const fake = new FakeProcessRunner();
  fake.expect((spec) => spec.args.includes('-f') && spec.args.some((arg) => arg.includes('print_format=json')), okResult('', analysisStderr));
  fake.expect((spec) => spec.args.some((arg) => arg.includes('linear=true')), okResult(), (spec) => { copyFileSync(spec.args[spec.args.indexOf('-i') + 1] ?? '', spec.args[spec.args.length - 1] ?? ''); });
  fake.expect(matchProgram('ffprobe.exe'), okResult(probeJson));
  fake.expect((spec) => spec.args.includes('ebur128=peak=true'), okResult('', ebur128Summary(integrated, peak)));
  return fake;
}

/** The options of one synthesis; the voice is supplied as the handle unless `extra.loadVoice` hands it over for synthesizeNarration to load and own. */
function options(dir: string, voice: KokoroHandle, runner: FakeProcessRunner | ChildProcessRunner, extra: Partial<SynthesizeOptions> = {}): SynthesizeOptions {
  let tick = 0;
  const base: SynthesizeOptions = { dataDir: join(dir, 'data'), text, voice: 'af_heart', outDir: join(dir, 'narration'), fps: 30, runner, ffmpegPath: 'C:\\t\\ffmpeg.exe', ffprobePath: 'C:\\t\\ffprobe.exe', log: new MemoryLogger(), signal: never, now: () => new Date(1_700_000_000_000 + (tick += 250)), mappedLibraries: () => ['C:\\WINDOWS\\SYSTEM32\\ntdll.dll'], platform: 'win32', ...extra };
  return extra.loadVoice === undefined ? { ...base, handle: voice } : base;
}

describe('synthesizeNarration with a fake voice and a scripted ffmpeg', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-synth-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('normalizes the text, reads one sentence at a time, joins them with the gap and writes every file', async () => {
    const voice = new FakeKokoro();
    const fake = scriptedFfmpeg();
    const log = new MemoryLogger();
    const document = await synthesizeNarration(options(dir, voice, fake, { log }));
    assert.deepEqual(voice.calls, [{ text: 'The bottle holds five hundred millilitres.', voice: 'af_heart' }, { text: 'Made by hand, since nineteen ninety-eight.', voice: 'af_heart' }]);
    assert.equal(voice.disposed, 0, 'a supplied voice belongs to the caller');
    fake.assertAllUsed();
    const outDir = join(dir, 'narration');
    assert.equal(statSync(sentenceWavPath(outDir, 0)).size, wavHeaderBytes + 24_000 * 2);
    assert.equal(statSync(sentenceWavPath(outDir, 1)).size, wavHeaderBytes + 12_000 * 2);
    const raw = parseWavHeader(readFileSync(join(outDir, narrationFileNames.raw)));
    assert.equal(raw.dataBytes, (24_000 + 8_400 + 12_000) * 2, 'one second, the 0.35 s gap, half a second');
    assert.deepEqual([raw.sampleRate, raw.channels, raw.bitsPerSample], [24_000, 1, 16]);
    assert.ok(existsSync(join(outDir, narrationFileNames.wav)));
    assert.equal(readFileSync(join(outDir, narrationFileNames.srt), 'utf8'), '1\n00:00:00,000 --> 00:00:01,000\nThe bottle holds five hundred millilitres.\n\n2\n00:00:01,350 --> 00:00:01,850\nMade by hand, since nineteen ninety-eight.\n');
    assert.deepEqual(JSON.parse(readFileSync(join(outDir, narrationFileNames.json), 'utf8')), document);
    assert.equal(document.kind, 'narration');
    assert.equal(document.text, 'The bottle holds five hundred millilitres. Made by hand, since nineteen ninety-eight.');
    assert.deepEqual(document.sentences.map((sentence) => [sentence.startFrame, sentence.endFrame]), [[0, 30], [40, 56]]);
    assert.equal(document.totalFrames, 56);
    assert.deepEqual({ fps: document.fps, sampleRate: document.sampleRate, voice: document.voice }, { fps: 30, sampleRate: 24_000, voice: 'af_heart' });
    assert.deepEqual(document.loudness, { integratedLufs: -16.2, truePeakDbtp: -2 });
    assert.equal(document.synthesisSeconds, 0.5, 'two sentences at one clock tick each');
    assert.equal(document.directMlMapped, false);
    assert.equal(document.wavPath, join(outDir, narrationFileNames.wav));
    assert.equal(document.srtPath, join(outDir, narrationFileNames.srt));
    assert.ok(log.messages.includes('info: sentence 1: 1.00 s: The bottle holds five hundred millilitres.'), log.messages.join('\n'));
    assert.ok(log.messages.includes('info: sentence 2: 0.50 s: Made by hand, since nineteen ninety-eight.'));
    assert.ok(log.messages.includes('info: DirectML.dll mapped into the process: no'));
  });

  it('loads the voice itself when no handle is supplied, and disposes only that one, after the DirectML check', async () => {
    const voice = new FakeKokoro();
    let disposedWhenChecked = -1;
    const loaded: string[] = [];
    const document = await synthesizeNarration(options(dir, voice, scriptedFfmpeg(), {
      outDir: join(dir, 'owned'),
      loadVoice: (dataDir) => { loaded.push(dataDir); return Promise.resolve(voice); },
      mappedLibraries: () => { disposedWhenChecked = voice.disposed; return []; },
    }));
    assert.deepEqual(loaded, [join(dir, 'data')]);
    assert.equal(voice.calls.length, 2);
    assert.equal(voice.disposed, 1);
    assert.equal(disposedWhenChecked, 0, 'the libraries are read while the model is still loaded');
    assert.equal(document.directMlMapped, false);
  });

  it('records DirectML as mapped on Windows when the report lists it, and never off Windows', async () => {
    const mapped = await synthesizeNarration(options(dir, new FakeKokoro(), scriptedFfmpeg(), { outDir: join(dir, 'mapped'), mappedLibraries: () => ['C:\\x\\DirectML.dll'] }));
    assert.equal(mapped.directMlMapped, true);
    const linux = await synthesizeNarration(options(dir, new FakeKokoro(), scriptedFfmpeg(), { outDir: join(dir, 'linux'), mappedLibraries: () => ['/x/DirectML.dll'], platform: 'linux' }));
    assert.equal(linux.directMlMapped, false);
  });

  it('fails with narration-loudness when the normalized file misses the target, keeping the raw file and releasing a voice it loaded', async () => {
    const voice = new FakeKokoro();
    await assert.rejects(synthesizeNarration(options(dir, voice, scriptedFfmpeg(-14.5, -2), { outDir: join(dir, 'loud'), loadVoice: () => Promise.resolve(voice) })), (error: unknown) => error instanceof VisionForgeError && error.code === 'narration-loudness' && /off by 1.5 LU/.test(error.message) && error.hint.includes(join(dir, 'loud', narrationFileNames.raw)));
    await assert.rejects(synthesizeNarration(options(dir, new FakeKokoro(), scriptedFfmpeg(-16, -1.2), { outDir: join(dir, 'peak') })), (error: unknown) => error instanceof VisionForgeError && error.code === 'narration-loudness' && /true peak -1.2 dBTP/.test(error.message));
    assert.equal(voice.disposed, 1);
    assert.ok(existsSync(join(dir, 'loud', narrationFileNames.raw)));
  });

  it('names the sentence with narration-synthesis-failed when the voice throws, releases a voice it loaded, and lets a cancellation through unchanged', async () => {
    class Broken extends FakeKokoro {
      override async synthesize(sentence: string, voice: string): Promise<SynthesizedAudio> {
        if (this.calls.length === 1) throw new Error('voice file af_heart.bin is missing');
        return super.synthesize(sentence, voice);
      }
    }
    const voice = new Broken();
    await assert.rejects(synthesizeNarration(options(dir, voice, new FakeProcessRunner(), { outDir: join(dir, 'broken'), loadVoice: () => Promise.resolve(voice) })), (error: unknown) => error instanceof VisionForgeError && error.code === 'narration-synthesis-failed' && /sentence 2 \("Made by hand, since nineteen ninety-eight\."\): voice file af_heart\.bin is missing/.test(error.message) && /audio install --verify/.test(error.hint) && error.cause instanceof Error);
    assert.equal(voice.disposed, 1);
    class Cancelling extends FakeKokoro {
      override synthesize(): Promise<SynthesizedAudio> {
        return Promise.reject(new CancelledError());
      }
    }
    await assert.rejects(synthesizeNarration(options(dir, new Cancelling(), new FakeProcessRunner(), { outDir: join(dir, 'cancelling') })), CancelledError);
  });

  it('refuses text without a sentence, a bad fps and a cancelled signal before any synthesis', async () => {
    const voice = new FakeKokoro();
    await assert.rejects(synthesizeNarration(options(dir, voice, new FakeProcessRunner(), { text: '   ' })), UsageError);
    await assert.rejects(synthesizeNarration(options(dir, voice, new FakeProcessRunner(), { fps: 0 })), UsageError);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(synthesizeNarration(options(dir, voice, new FakeProcessRunner(), { signal: aborted.signal, outDir: join(dir, 'cancelled') })), CancelledError);
    assert.equal(voice.calls.length, 0);
  });

  it('rejects a sentence that comes back at any rate but 24 kHz, whether the first or a later one, so the document never describes a file that does not exist', async () => {
    class Drifting extends FakeKokoro {
      override async synthesize(sentence: string, voice: string): Promise<SynthesizedAudio> {
        const audio = await super.synthesize(sentence, voice);
        return { samples: audio.samples, sampleRate: this.calls.length === 1 ? 24_000 : 22_050 };
      }
    }
    await assert.rejects(synthesizeNarration(options(dir, new Drifting(), new FakeProcessRunner(), { outDir: join(dir, 'drift') })), (error: unknown) => error instanceof VisionForgeError && error.code === 'narration-sample-rate' && /Sentence 2 came back at 22050 Hz/.test(error.message));
    const other = new FakeKokoro(22_050);
    await assert.rejects(synthesizeNarration(options(dir, other, new FakeProcessRunner(), { outDir: join(dir, 'other-rate') })), (error: unknown) => error instanceof VisionForgeError && error.code === 'narration-sample-rate' && /Sentence 1 came back at 22050 Hz/.test(error.message));
    assert.equal(other.calls.length, 1, 'the first sentence already fails');
  });
});

const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe(ffmpeg?.path);

describe('synthesizeNarration with a fake voice through the installed ffmpeg', { skip: ffmpeg === undefined || ffprobe === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-synth-ffmpeg-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('normalizes two sine sentences to -16 LUFS under -1.5 dBTP and the measurement in the document matches ebur128', async () => {
    const runner = new ChildProcessRunner();
    const document = await synthesizeNarration(options(dir, new FakeKokoro(), runner, { ffmpegPath: ffmpeg?.path ?? '', ffprobePath: ffprobe?.path ?? '' }));
    assert.ok(Math.abs(document.loudness.integratedLufs - narrationLoudnessTarget) <= 1, `integrated ${document.loudness.integratedLufs}`);
    assert.ok(document.loudness.truePeakDbtp <= narrationTruePeakCeiling, `true peak ${document.loudness.truePeakDbtp}`);
    const again = await measureLoudness(runner, ffmpeg?.path ?? '', ffprobe?.path ?? '', document.wavPath, never);
    assert.deepEqual(again, { integrated: document.loudness.integratedLufs, truePeak: document.loudness.truePeakDbtp });
    // ffmpeg adds a LIST chunk after "fmt ", so the file is probed rather than parsed as a canonical header.
    assert.deepEqual(await probeAudio(runner, ffprobe?.path ?? '', document.wavPath, never), { codec: 'pcm_s16le', sampleRate: 24_000, channels: 1 });
  });
});

describe('the synth action', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-synth-cmd-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  function context(dataDir: string): CommandContext {
    return { dataDir, outDir: join(dir, 'out'), cwd: dir, runner: new FakeProcessRunner(), signal: never, log: new MemoryLogger(), now: () => new Date() };
  }

  it('takes the default voice when none is named, any offered voice, and names the offered voices with grades for an unknown one', () => {
    assert.equal(resolveVoice(undefined), defaultVoice);
    const another = offeredVoices.find((voice) => voice.name !== defaultVoice);
    assert.ok(another !== undefined, 'more than one voice is offered');
    assert.equal(resolveVoice(another.name), another.name);
    assert.throws(() => resolveVoice('am_adam'), (error: unknown) => error instanceof VisionForgeError && error.code === 'voice-unknown' && /"am_adam" is not offered/.test(error.message) && error.hint.includes(`${defaultVoice} (A)`) && error.hint.includes(`${another.name} (${another.grade})`));
    assert.throws(() => resolveVoice('zz_nobody'), (error: unknown) => error instanceof VisionForgeError && error.code === 'voice-unknown');
  });

  it('reads --text, or --script relative to the working directory, and refuses both, neither and a missing file', () => {
    writeFileSync(join(dir, 'script.txt'), 'From a file.\n', 'utf8');
    assert.equal(readNarrationText(parseArguments(['--text', 'Hi.'], synthOptions), dir), 'Hi.');
    assert.equal(readNarrationText(parseArguments(['--script', 'script.txt'], synthOptions), dir), 'From a file.\n');
    assert.throws(() => readNarrationText(parseArguments(['--text', 'a', '--script', 'b'], synthOptions), dir), UsageError);
    assert.throws(() => readNarrationText(parseArguments([], synthOptions), dir), (error: unknown) => error instanceof UsageError && /Missing --text or --script/.test(error.message));
    assert.throws(() => readNarrationText(parseArguments(['--script', 'absent.txt'], synthOptions), dir), (error: unknown) => error instanceof VisionForgeError && error.code === 'data-file');
  });

  it('defaults fps to 30 and the gap to 0.35, allows a zero gap and refuses zero fps or a negative gap', () => {
    assert.equal(positiveOption(parseArguments([], synthOptions), 'fps', defaultFps), 30);
    assert.equal(positiveOption(parseArguments(['--gap', '0'], synthOptions), 'gap', defaultGapSeconds, true), 0);
    assert.equal(positiveOption(parseArguments([], synthOptions), 'gap', defaultGapSeconds, true), 0.35);
    assert.throws(() => positiveOption(parseArguments(['--fps', '0'], synthOptions), 'fps', defaultFps), UsageError);
    assert.throws(() => positiveOption(parseArguments(['--gap', '-1'], synthOptions), 'gap', defaultGapSeconds, true), UsageError);
    assert.throws(() => positiveOption(parseArguments(['--fps', 'x'], synthOptions), 'fps', defaultFps), UsageError);
  });

  it('fails closed with narration-not-installed on an empty data directory, before ffmpeg or the model is touched', async () => {
    const dataDir = join(dir, 'empty-data');
    mkdirSync(dataDir, { recursive: true });
    assert.throws(() => assertNarrationInstalled(dataDir), (error: unknown) => error instanceof NarrationNotInstalledError && error.code === 'narration-not-installed' && error.missing.length > 0 && /kokoro-js/.test(error.message) && /audio install --yes/.test(error.hint));
    const ctx = context(dataDir);
    await assert.rejects(runSynth(ctx, parseArguments(['--text', 'Hello there.'], synthOptions)), (error: unknown) => error instanceof NarrationNotInstalledError);
    assert.equal((ctx.runner as FakeProcessRunner).invocations.length, 0);
  });

  it('refuses an unknown voice before the install check', async () => {
    await assert.rejects(runSynth(context(join(dir, 'empty-data')), parseArguments(['--text', 'Hello.', '--voice', 'am_adam'], synthOptions)), (error: unknown) => error instanceof VisionForgeError && error.code === 'voice-unknown');
  });
});
