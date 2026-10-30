import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loudnessApplyArguments, loudnessMeasureArguments, narrationLoudnessTarget, narrationLoudnormApplyFilter, narrationLoudnormMeasureFilter, narrationTruePeakCeiling, normalizeNarrationLoudness } from '../../src/audio/loudness.ts';
import { DataFileError } from '../../src/errors/vision-forge-error.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { measureLoudness } from '../../src/qa/audio-checks.ts';
import { probeAudio } from '../../src/qa/probe.ts';
import { findFfmpeg, findFfprobe } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;
const measured = { inputI: '-26.53', inputTp: '-19.56', inputLra: '0.40', inputThresh: '-36.53', targetOffset: '-0.39' };
const analysisStderr = '[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-26.53",\n\t"input_tp" : "-19.56",\n\t"input_lra" : "0.40",\n\t"input_thresh" : "-36.53",\n\t"output_i" : "-15.61",\n\t"output_tp" : "-8.78",\n\t"output_lra" : "0.00",\n\t"output_thresh" : "-25.61",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "-0.39"\n}\n';

describe('the narration loudnorm filters', () => {
  it('target -16 LUFS and -1.5 dBTP with the assembler\'s loudness range, JSON in pass one', () => {
    assert.equal(narrationLoudnessTarget, -16);
    assert.equal(narrationTruePeakCeiling, -1.5);
    assert.equal(narrationLoudnormMeasureFilter(), 'loudnorm=I=-16:TP=-2:LRA=11:print_format=json');
  });

  it('apply the measured values in linear mode with a summary in pass two', () => {
    assert.equal(narrationLoudnormApplyFilter(measured), 'loudnorm=I=-16:TP=-2:LRA=11:measured_I=-26.53:measured_TP=-19.56:measured_LRA=0.40:measured_thresh=-36.53:offset=-0.39:linear=true:print_format=summary');
  });

  it('build the two ffmpeg argument lists: analysis to the null muxer, then 24 kHz mono pcm_s16le', () => {
    assert.deepEqual(loudnessMeasureArguments('in.wav'), ['-nostats', '-i', 'in.wav', '-af', 'loudnorm=I=-16:TP=-2:LRA=11:print_format=json', '-f', 'null', '-']);
    assert.deepEqual(loudnessApplyArguments('in.wav', 'out.wav', measured), ['-nostats', '-y', '-i', 'in.wav', '-af', narrationLoudnormApplyFilter(measured), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', 'out.wav']);
  });
});

describe('normalizeNarrationLoudness with a scripted ffmpeg', () => {
  it('feeds pass one\'s measurement into pass two and returns it', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe', ['-hide_banner', ...loudnessMeasureArguments('raw.wav')]), okResult('', analysisStderr));
    fake.expect(matchProgram('ffmpeg.exe', ['-hide_banner', ...loudnessApplyArguments('raw.wav', 'out.wav', measured)]), okResult());
    const result = await normalizeNarrationLoudness({ runner: fake, ffmpegPath: 'C:\\t\\ffmpeg.exe', input: 'raw.wav', output: 'out.wav', signal: never });
    assert.deepEqual(result, measured);
    fake.assertAllUsed();
  });

  it('fails with data-file when pass one prints no measurement, before pass two runs', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult('', 'size=N/A time=00:00:03.00\n'));
    await assert.rejects(normalizeNarrationLoudness({ runner: fake, ffmpegPath: 'C:\\t\\ffmpeg.exe', input: 'raw.wav', output: 'out.wav', signal: never }), (error: unknown) => error instanceof DataFileError && /no measurement/.test(error.message));
    assert.equal(fake.invocations.length, 1);
  });
});

const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe(ffmpeg?.path);

describe('normalizeNarrationLoudness through the installed ffmpeg', { skip: ffmpeg === undefined || ffprobe === undefined ? 'ffmpeg is not installed' : false }, () => {
  const runner = new ChildProcessRunner();
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-loudness-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('brings a quiet four-second sine to within 1 LU of -16 LUFS under -1.5 dBTP at 24 kHz mono', async () => {
    const raw = join(dir, 'raw.wav');
    const out = join(dir, 'narration.wav');
    const made = await runner.run({ label: 'ffmpeg', executable: ffmpeg?.path ?? '', args: ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=4', '-af', 'volume=-12dB', '-c:a', 'pcm_s16le', raw], timeoutMs: 60_000 }, never);
    assert.equal(made.exitCode, 0, made.stderr);
    const before = await measureLoudness(runner, ffmpeg?.path ?? '', ffprobe?.path ?? '', raw, never);
    assert.ok(before !== undefined && before.integrated < -20, `the raw sine should be quiet, measured ${String(before?.integrated)}`);
    const measurement = await normalizeNarrationLoudness({ runner, ffmpegPath: ffmpeg?.path ?? '', input: raw, output: out, signal: never });
    assert.ok(Math.abs(Number(measurement.inputI) - before.integrated) < 1, `loudnorm measured ${measurement.inputI}, ebur128 ${before.integrated}`);
    assert.ok(existsSync(out));
    const after = await measureLoudness(runner, ffmpeg?.path ?? '', ffprobe?.path ?? '', out, never);
    assert.ok(after !== undefined && Math.abs(after.integrated - narrationLoudnessTarget) <= 1, `integrated ${String(after?.integrated)} LUFS`);
    assert.ok(after.truePeak <= narrationTruePeakCeiling, `true peak ${after.truePeak} dBTP`);
    assert.deepEqual(await probeAudio(runner, ffprobe?.path ?? '', out, never), { codec: 'pcm_s16le', sampleRate: 24_000, channels: 1 });
    // The output must not be an untouched copy of the input.
    copyFileSync(raw, join(dir, 'copy.wav'));
    const copy = await measureLoudness(runner, ffmpeg?.path ?? '', ffprobe?.path ?? '', join(dir, 'copy.wav'), never);
    assert.ok(copy !== undefined && Math.abs(copy.integrated - after.integrated) > 5);
  });
});
