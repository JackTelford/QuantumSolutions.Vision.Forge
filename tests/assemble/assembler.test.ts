import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { LoudnessMeasurementError } from '../../src/assemble/assemble-error.ts';
import { Assembler, jobTempDir, quoteForLog } from '../../src/assemble/assembler.ts';
import { encodeInvocation, filterGraph } from '../../src/assemble/invocation.ts';
import { probeArguments, probeTimeoutMs } from '../../src/assemble/probe.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { ProcessFailedError } from '../../src/errors/vision-forge-error.ts';
import type { AssemblyPlan, AudioMix, Clip } from '../../src/shared/contracts/assembly-plan.ts';
import { filterPath } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;
const ffmpegExe = 'C:\\tools\\ffmpeg\\ffmpeg.exe';
const ffprobeExe = 'C:\\tools\\ffmpeg\\ffprobe.exe';
const tags = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
/** The delivery's tail: the grade now sits per clip (plate.ts), so without a grade only the BT.709 conversion follows the join. */
const tail = 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p';
const oneLine: AudioMix = { narration: [{ path: 'C:\\vf\\n1.wav', startFrame: 0 }], music: null, loudnessLufs: -16, truePeakDbtp: -1.5 };

function clip(id: string, path: string, durationFrames = 30): Clip {
  return { id, source: { kind: 'frames', path, startNumber: 1 }, durationFrames };
}

/** Clip `index` brought to the join format with no grade and no overlay (plate.ts): 16-bit RGB, where the join stays without a vignette or a text plate. */
function plated(index: number): string {
  return `[c${index}]format=gbrp16le[p${index}]`;
}

function normalized(index: number, durationFrames: number): string {
  return `[${index}:v]scale=iw*sar:ih,scale=320:180:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,trim=end_frame=${durationFrames},setpts=PTS-STARTPTS,fps=30[c${index}]`;
}

function twoClipDissolve(outputDir: string, overrides: Partial<AssemblyPlan> = {}): AssemblyPlan {
  return {
    kind: 'assembly-plan',
    version: 1,
    fps: 30,
    width: 320,
    height: 180,
    clips: [clip('a', 'C:\\vf\\a\\f%04d.png'), clip('b', 'C:\\vf\\b\\f%04d.png')],
    transitions: [{ afterClipId: 'a', type: 'dissolve', frames: 10 }],
    output: { path: join(outputDir, 'film.mp4'), codec: 'h264', crf: 16, preset: 'medium', faststart: true },
    ...overrides,
  };
}

const loudnormJson = '{\n\t"input_i" : "-26.53",\n\t"input_tp" : "-19.56",\n\t"input_lra" : "0.40",\n\t"input_thresh" : "-36.53",\n\t"output_i" : "-15.61",\n\t"output_tp" : "-8.78",\n\t"output_lra" : "0.00",\n\t"output_thresh" : "-25.61",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "-0.39"\n}\n';
const analysisStderr = `[Parsed_loudnorm_0 @ 0x1]\n${loudnormJson}`;

describe('quoteForLog', () => {
  it('leaves plain arguments alone and double-quotes those with whitespace or shell characters, escaping inner quotes', () => {
    assert.equal(quoteForLog('-filter_complex'), '-filter_complex');
    assert.equal(quoteForLog('C:\\vf\\a\\f%04d.png'), 'C:\\vf\\a\\f%04d.png');
    assert.equal(quoteForLog('C:\\Users\\Jane Doe\\film.mp4'), '"C:\\Users\\Jane Doe\\film.mp4"');
    assert.equal(quoteForLog('[0:v]scale=1:1[c0];[c0]null[v]'), '"[0:v]scale=1:1[c0];[c0]null[v]"');
    assert.equal(quoteForLog('a|b&c<d>e'), '"a|b&c<d>e"');
    assert.equal(quoteForLog('say "hi"'), '"say \\"hi\\""');
  });
});

describe('Assembler', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-asm-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('runs exactly one ffmpeg command for a silent two-clip dissolve, with the golden argument array: each clip is plated on its own before the join, since a text plate must land on its graded picture and not on a dissolve of two', async () => {
    const plan = twoClipDissolve(dir);
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult());
    const log = new MemoryLogger();
    const result = await new Assembler(fake, ffmpegExe, ffprobeExe, log).assemble(plan, never);
    const graph = [
      normalized(0, 30),
      normalized(1, 30),
      plated(0),
      plated(1),
      '[p0][p1]xfade=transition=fade:duration=0.333333:offset=0.666667[vout]',
      `[vout]${tail}[v]`,
    ].join(';');
    assert.deepEqual(fake.invocations.map((spec) => spec.args), [[
      '-hide_banner', '-y',
      '-framerate', '30', '-start_number', '1', '-i', 'C:\\vf\\a\\f%04d.png',
      '-framerate', '30', '-start_number', '1', '-i', 'C:\\vf\\b\\f%04d.png',
      '-filter_complex', graph,
      '-map', '[v]',
      '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-maxrate', '500k', '-bufsize', '1000k', '-pix_fmt', 'yuv420p', ...tags, '-movflags', '+faststart',
      plan.output.path,
    ]]);
    assert.equal(fake.invocations[0]?.executable, ffmpegExe);
    assert.deepEqual(result, { outputPath: plan.output.path, durationFrames: 50, durationSeconds: 50 / 30, codec: 'h264' });
    assert.ok(log.messages.some((m) => m.startsWith('debug: ') && m.includes('-filter_complex')), 'the ffmpeg command is logged at debug level');
    assert.ok(!existsSync(jobTempDir(plan.output.path)), 'the job temp dir is removed on success');
    fake.assertAllUsed();
  });

  it('logs the command with the filter graph and paths with spaces double-quoted while the spawned arguments stay raw', async () => {
    const plan = twoClipDissolve(join(dir, 'with space'));
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult());
    const log = new MemoryLogger();
    await new Assembler(fake, 'C:\\Program Files\\ffmpeg\\ffmpeg.exe', ffprobeExe, log).assemble(plan, never);
    const graph = filterGraph(plan, undefined);
    const line = log.messages.find((m) => m.startsWith('debug: ') && m.includes('-filter_complex'));
    assert.ok(line !== undefined);
    assert.ok(line.startsWith('debug: "C:\\Program Files\\ffmpeg\\ffmpeg.exe" -hide_banner -y '), line);
    assert.ok(line.includes(` -filter_complex "${graph}" -map "[v]" `), line);
    assert.ok(line.endsWith(` "${plan.output.path}"`), line);
    assert.ok(fake.invocations[0]?.args.includes(graph), 'the raw graph is what ffmpeg receives');
    assert.ok(fake.invocations[0]?.args.includes(plan.output.path));
  });

  it('joins a cut and a wipe across three clips with concat then xfade after each clip is plated', () => {
    const plan = twoClipDissolve(dir, {
      clips: [clip('a', 'C:\\vf\\a\\f%04d.png'), clip('b', 'C:\\vf\\b\\f%04d.png'), { id: 'c', source: { kind: 'video', path: 'C:\\vf\\c.mp4', startNumber: 0 }, durationFrames: 30 }],
      transitions: [{ afterClipId: 'b', type: 'wipe-left', frames: 15 }],
    });
    assert.equal(filterGraph(plan, undefined), [
      normalized(0, 30),
      normalized(1, 30),
      normalized(2, 30),
      plated(0),
      plated(1),
      plated(2),
      '[p0][p1]concat=n=2:v=1:a=0,fps=30[j1]',
      '[j1][p2]xfade=transition=wipeleft:duration=0.5:offset=1.5[vout]',
      `[vout]${tail}[v]`,
    ].join(';'));
    assert.deepEqual(encodeInvocation(plan, undefined).slice(0, 11), ['-y', '-framerate', '30', '-start_number', '1', '-i', 'C:\\vf\\a\\f%04d.png', '-framerate', '30', '-start_number', '1']);
    assert.deepEqual(encodeInvocation(plan, undefined).slice(11, 15), ['-i', 'C:\\vf\\b\\f%04d.png', '-i', 'C:\\vf\\c.mp4']);
  });

  it('with narration and ducked music runs the mix, the analysis and the encode, and reports the measured loudness', async () => {
    const plan = twoClipDissolve(dir, {
      audio: {
        narration: [{ path: 'C:\\vf\\n1.wav', startFrame: 10 }, { path: 'C:\\vf\\n2.wav', startFrame: 30 }],
        music: { path: 'C:\\vf\\music.wav', duckUnderNarration: true, gainDb: -12 },
        loudnessLufs: -16,
        truePeakDbtp: -1.5,
      },
    });
    const temp = jobTempDir(plan.output.path);
    const mixPath = join(temp, 'mix.wav');
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult(), () => { assert.ok(existsSync(temp), 'the temp dir exists while ffmpeg runs'); });
    fake.expect(matchProgram('ffmpeg.exe'), okResult('', analysisStderr));
    fake.expect(matchProgram('ffmpeg.exe'), okResult('', 'Input Integrated:    -26.5 LUFS\nOutput Integrated:   -15.7 LUFS\n'));
    const result = await new Assembler(fake, ffmpegExe, ffprobeExe, new MemoryLogger()).assemble(plan, never);
    const mixGraph = [
      '[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=333|333[n0]',
      '[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=1000|1000[n1]',
      '[n0][n1]amix=inputs=2:normalize=0[nar]',
      '[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=-12dB[mus]',
      '[nar]asplit=2[nar0][nar1]',
      '[nar1]apad=whole_dur=1.666667[key]',
      '[mus][key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[duck]',
      '[nar0][duck]amix=inputs=2:normalize=0[mixed]',
      '[mixed]apad=whole_dur=1.666667,atrim=end=1.666667,asetpts=PTS-STARTPTS[amix]',
    ].join(';');
    const encodeGraph = [
      normalized(0, 30),
      normalized(1, 30),
      plated(0),
      plated(1),
      '[p0][p1]xfade=transition=fade:duration=0.333333:offset=0.666667[vout]',
      `[vout]${tail}[v]`,
      '[2:a]loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-26.53:measured_TP=-19.56:measured_LRA=0.40:measured_thresh=-36.53:offset=-0.39:linear=true:print_format=summary[aout]',
    ].join(';');
    assert.deepEqual(fake.invocations.map((spec) => spec.args), [
      ['-hide_banner', '-y', '-i', 'C:\\vf\\n1.wav', '-i', 'C:\\vf\\n2.wav', '-i', 'C:\\vf\\music.wav', '-filter_complex', mixGraph, '-map', '[amix]', '-c:a', 'pcm_f32le', '-ar', '48000', mixPath],
      ['-hide_banner', '-i', mixPath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
      [
        '-hide_banner', '-y',
        '-framerate', '30', '-start_number', '1', '-i', 'C:\\vf\\a\\f%04d.png',
        '-framerate', '30', '-start_number', '1', '-i', 'C:\\vf\\b\\f%04d.png',
        '-i', mixPath,
        '-filter_complex', encodeGraph,
        '-map', '[v]', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-maxrate', '500k', '-bufsize', '1000k', '-pix_fmt', 'yuv420p', ...tags, '-movflags', '+faststart',
        plan.output.path,
      ],
    ]);
    assert.deepEqual(result.loudness, { inputI: -26.53, outputI: -15.7 });
    assert.ok(!existsSync(temp));
    fake.assertAllUsed();
  });

  it('omits outputI, warns and keeps the logs when the encode summary has no Output Integrated line, never substituting the target', async () => {
    const plan = twoClipDissolve(join(dir, 'nosummary'), { audio: oneLine });
    const temp = jobTempDir(plan.output.path);
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult());
    fake.expect(matchProgram('ffmpeg.exe'), okResult('', analysisStderr));
    fake.expect(matchProgram('ffmpeg.exe'), okResult('', 'Input Integrated:    -26.5 LUFS\n'));
    const log = new MemoryLogger();
    const result = await new Assembler(fake, ffmpegExe, ffprobeExe, log).assemble(plan, never);
    assert.deepEqual(result.loudness, { inputI: -26.53 });
    assert.ok(log.messages.includes(`warn: loudnorm printed no Output Integrated line; see ${join(temp, 'encode.log')}`), log.messages.join('\n'));
    assert.ok(existsSync(temp), 'the temp dir with encode.log is kept');
  });

  it('burns captions in after the delivery tail and copies the SRT sidecar next to the output', async () => {
    const srt = join(dir, 'captions.srt');
    writeFileSync(srt, '1\n00:00:00,500 --> 00:00:01,500\nHello\n', 'utf8');
    const outputDir = join(dir, 'captioned');
    const plan = twoClipDissolve(outputDir, { captions: { srtPath: srt, burnIn: true } });
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult());
    const result = await new Assembler(fake, ffmpegExe, ffprobeExe, new MemoryLogger()).assemble(plan, never);
    const graph = fake.invocations[0]?.args[fake.invocations[0].args.indexOf('-filter_complex') + 1] ?? '';
    assert.ok(graph.endsWith(`[vout]${tail},subtitles=${filterPath(srt)}[v]`), graph);
    assert.equal(result.sidecarPath, join(outputDir, 'film.srt'));
    assert.ok(existsSync(join(outputDir, 'film.srt')));
  });

  it('uses the prores encoder and PCM audio for a .mov delivery', () => {
    const plan = twoClipDissolve(dir, {
      output: { path: join(dir, 'film.mov'), codec: 'prores', crf: 16, preset: 'medium', faststart: false },
      audio: oneLine,
    });
    const measured = { inputI: '-20', inputTp: '-5', inputLra: '1', inputThresh: '-30', targetOffset: '0' };
    const args = encodeInvocation(plan, { audio: oneLine, mixPath: 'C:\\vf\\mix.wav', measured });
    assert.deepEqual(args.slice(args.indexOf('-map')), ['-map', '[v]', '-map', '[aout]', '-c:a', 'pcm_s16le', '-ar', '48000', '-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', ...tags, join(dir, 'film.mov')]);
    assert.ok(filterGraph(plan, undefined).includes('format=yuv422p10le[v]'));
  });

  it('applies the hevc encoder arguments', () => {
    const plan = twoClipDissolve(dir, { output: { path: join(dir, 'film.mp4'), codec: 'hevc', crf: 22, preset: 'fast', faststart: true } });
    const args = encodeInvocation(plan, undefined);
    assert.deepEqual(args.slice(args.indexOf('-c:v')), ['-c:v', 'libx265', '-crf', '22', '-preset', 'fast', '-maxrate', '500k', '-bufsize', '1000k', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', ...tags, '-movflags', '+faststart', join(dir, 'film.mp4')]);
  });

  it('throws ProcessFailedError when ffmpeg fails, leaves the temp directory with its log and removes the half-written delivery and the copied sidecar', async () => {
    const srt = join(dir, 'failing-captions.srt');
    writeFileSync(srt, '1\n00:00:00,500 --> 00:00:01,500\nHello\n', 'utf8');
    const outputDir = join(dir, 'failing');
    const plan = twoClipDissolve(outputDir, { captions: { srtPath: srt, burnIn: false } });
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), failedResult(1, 'No such file or directory'), () => { writeFileSync(plan.output.path, 'truncated', 'utf8'); });
    await assert.rejects(new Assembler(fake, ffmpegExe, ffprobeExe, new MemoryLogger()).assemble(plan, never), (error: unknown) => error instanceof ProcessFailedError && /encode/.test(error.message) && /encode\.log/.test(error.hint));
    assert.ok(existsSync(jobTempDir(plan.output.path)), 'the temp dir is kept');
    assert.ok(!existsSync(plan.output.path), 'the half-written delivery is removed');
    assert.ok(!existsSync(join(outputDir, 'film.srt')), 'the copied sidecar is removed');
    assert.ok(existsSync(srt), 'the source SRT is untouched');
  });

  it('keeps an SRT that already was the sidecar when the encode fails', async () => {
    const outputDir = join(dir, 'failing-own-srt');
    mkdirSync(outputDir, { recursive: true });
    const sidecar = join(outputDir, 'film.srt');
    writeFileSync(sidecar, 'theirs\n', 'utf8');
    const plan = twoClipDissolve(outputDir, { captions: { srtPath: sidecar, burnIn: false } });
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), failedResult(1, 'boom'));
    await assert.rejects(new Assembler(fake, ffmpegExe, ffprobeExe, new MemoryLogger()).assemble(plan, never), ProcessFailedError);
    assert.ok(existsSync(sidecar), 'the pre-existing sidecar stays');
  });

  it('warns instead of failing a finished assembly when the temp directory cannot be removed', { skip: process.platform !== 'win32' ? 'only Windows refuses to remove the working directory of a process' : false }, async () => {
    const plan = twoClipDissolve(join(dir, 'busy'));
    const temp = jobTempDir(plan.output.path);
    const previousCwd = process.cwd();
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult(), () => { process.chdir(temp); });
    const log = new MemoryLogger();
    try {
      const result = await new Assembler(fake, ffmpegExe, ffprobeExe, log).assemble(plan, never);
      assert.equal(result.durationFrames, 50);
      assert.ok(log.messages.some((m) => m.startsWith(`warn: could not remove ${temp}: `)), log.messages.join('\n'));
      assert.ok(existsSync(temp), 'the directory the process is in stays');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('throws LoudnessMeasurementError when the analysis pass prints no statistics', async () => {
    const plan = twoClipDissolve(join(dir, 'noloud'), { audio: oneLine });
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult());
    fake.expect(matchProgram('ffmpeg.exe'), okResult('', 'nothing measured'));
    await assert.rejects(new Assembler(fake, ffmpegExe, ffprobeExe, new MemoryLogger()).assemble(plan, never), LoudnessMeasurementError);
  });

  it('probes the delivery with ffprobe under a budget sized by the frame count', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffprobe.exe'), okResult('width=320\nheight=180\nsample_aspect_ratio=1:1\npix_fmt=yuv420p\ncolor_space=bt709\nr_frame_rate=30/1\nnb_read_frames=18000\n'));
    const probed = await new Assembler(fake, ffmpegExe, ffprobeExe, new MemoryLogger()).probeOutput('C:\\vf\\out\\film.mp4', 18_000, never);
    assert.equal(probed.frames, 18_000);
    assert.equal(fake.invocations[0]?.executable, ffprobeExe);
    assert.deepEqual(fake.invocations[0]?.args, ['-hide_banner', ...probeArguments('C:\\vf\\out\\film.mp4')]);
    assert.equal(fake.invocations[0]?.timeoutMs, probeTimeoutMs(18_000));
    assert.equal(fake.invocations[0]?.timeoutMs, 1_800_000);
  });
});
