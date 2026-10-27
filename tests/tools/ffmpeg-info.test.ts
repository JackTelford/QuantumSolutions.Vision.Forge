import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { describeFfmpegGaps, ffmpegEncoders, ffmpegFilters, ffmpegVersion, missingEncoders, missingFilters, missingOptionalEncoders, missingSheetFilters, optionalEncoders, parseEncoderNames, parseFfmpegVersion, parseFilterNames, queryLabel, requiredEncoders, requiredFilters, sheetFilters } from '../../src/tools/ffmpeg-info.ts';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

/** Captured from `ffmpeg -version` on the owner's machine (probe P6). */
const versionOutput = [
  'ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers',
  'built with gcc 16.2.0 (Rev3, Built by MSYS2 project)',
  'configuration: --enable-gpl --enable-version3 --enable-static',
  'libavutil      60. 20.100 / 60. 20.100',
].join('\r\n');

/**
 * Captured from `ffmpeg -hide_banner -filters` on ffmpeg 9.0.2, cut down to
 * the header and a few lines. 9.x prints two flag columns (timeline, slice
 * threading) on every one of its 579 filter lines. The `color` and
 * `nullsink` lines below are in the format of ffmpeg 7.x and earlier, which
 * printed a third column (command support, ` T.C`); they are kept so the
 * parser's acceptance of both widths stays tested.
 */
const filtersOutput = [
  'Filters:',
  '  T.. = Timeline support',
  '  .S. = Slice threading',
  '  A = Audio input/output',
  '  V = Video input/output',
  '  N = Dynamic number and/or type of input/output',
  '  | = Source or sink filter',
  '  ------',
  ' TS aap               AA->A      Apply Affine Projection algorithm to first audio stream.',
  ' .. acrossfade        N->A       Cross fade two input audio streams.',
  ' TS lut3d             V->V       Adjust colors using a 3D LUT.',
  ' T. metadata          V->V       Manipulate video frame metadata.',
  ' .. scdet             V->V       Detect video scene change',
  ' .. select            V->N       Select video frames to pass in output.',
  ' .. tpad              V->V       Temporarily pad video frames.',
  ' .S xfade             VV->V      Cross fade one video with another video.',
  ' .. concat            N->N       Concatenate audio and video streams.',
  ' ... color             |->V       Provide an uniformly colored input.',
  ' ... nullsink          V->|       Do absolutely nothing with the input video.',
  '',
].join('\n');

/** Captured from `ffmpeg -hide_banner -encoders`, cut down to the legend and a few lines. */
const encodersOutput = [
  'Encoders:',
  ' V..... = Video',
  ' A..... = Audio',
  ' S..... = Subtitle',
  ' .F.... = Frame-level multithreading',
  ' ..S... = Slice-level multithreading',
  ' ...X.. = Codec is experimental',
  ' ....B. = Supports draw_horiz_band',
  ' .....D = Supports direct rendering method 1',
  ' ------',
  ' V....D a64multi             Multicolor charset for Commodore 64 (codec a64_multi)',
  ' V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)',
  ' V....D libx265              libx265 H.265 / HEVC (codec hevc)',
  ' VFS... prores_ks            Apple ProRes (iCodec Pro) (codec prores)',
  ' A....D aac                  AAC (Advanced Audio Coding)',
  ' A....D libopus              libopus Opus (codec opus)',
  ' A....D pcm_s16le            PCM signed 16-bit little-endian',
  ' S..... srt                  SubRip subtitle',
  '',
].join('\n');

describe('parseFfmpegVersion', () => {
  it('takes the version token of the first line, including the build suffix', () => {
    assert.equal(parseFfmpegVersion(versionOutput), '9.0.2-full_build-www.gyan.dev');
    assert.equal(parseFfmpegVersion('ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\n'), '7.1.1');
    assert.equal(parseFfmpegVersion('ffprobe version 9.0.2-full_build-www.gyan.dev Copyright'), '9.0.2-full_build-www.gyan.dev');
    assert.equal(parseFfmpegVersion('ffmpeg version n8.1.3-24-g92611900bb-20261026 Copyright (c) 2000-2025 the FFmpeg developers'), '8.1.3-24-g92611900bb-20261026');
    assert.equal(parseFfmpegVersion('ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/  Copyright'), '7.0.2-static');
  });

  it('returns undefined for output that is not a version banner', () => {
    assert.equal(parseFfmpegVersion(''), undefined);
    assert.equal(parseFfmpegVersion('Unrecognized option'), undefined);
  });
});

describe('parseFilterNames and parseEncoderNames', () => {
  it('lists filter names in both the two-column (9.x) and three-column (7.x) formats, including sources and sinks, and skips the legend', () => {
    assert.deepEqual(parseFilterNames(filtersOutput), ['aap', 'acrossfade', 'lut3d', 'metadata', 'scdet', 'select', 'tpad', 'xfade', 'concat', 'color', 'nullsink']);
  });

  it('lists encoder names and skips the legend', () => {
    assert.deepEqual(parseEncoderNames(encodersOutput), ['a64multi', 'libx264', 'libx265', 'prores_ks', 'aac', 'libopus', 'pcm_s16le', 'srt']);
  });
});

describe('required sets', () => {
  it('name the filters and encoders probe P6 proved and nothing missing from a complete build', () => {
    assert.equal(requiredFilters.length, 24);
    assert.deepEqual(sheetFilters, ['drawtext', 'tile']);
    assert.deepEqual(requiredEncoders, ['libx264', 'aac', 'pcm_s16le']);
    assert.deepEqual(optionalEncoders, ['libx265', 'prores_ks', 'libopus']);
    assert.deepEqual(missingFilters(requiredFilters), []);
    assert.deepEqual(missingEncoders(requiredEncoders), []);
    assert.deepEqual(missingOptionalEncoders([...requiredEncoders, ...optionalEncoders]), []);
  });

  it('report what a cut-down build lacks, in required order, as sentences with install advice', () => {
    assert.deepEqual(missingFilters(['scale', 'xfade']), requiredFilters.filter((name) => name !== 'scale' && name !== 'xfade'));
    assert.deepEqual(missingEncoders(['aac']), ['libx264', 'pcm_s16le']);
    assert.deepEqual(missingOptionalEncoders(['libopus']), ['libx265', 'prores_ks']);
    const problems = describeFfmpegGaps([...requiredFilters.filter((name) => name !== 'lut3d'), ...sheetFilters], ['libx264']);
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? '', /missing the required filter lut3d; install a full build/);
    assert.match(problems[1] ?? '', /missing the required encoders aac, pcm_s16le/);
    assert.deepEqual(describeFfmpegGaps([...requiredFilters, ...sheetFilters], requiredEncoders), []);
  });

  it('keep the lanes open without drawtext and tile, and say the contact sheet needs them', () => {
    assert.deepEqual(missingFilters(requiredFilters), []);
    assert.deepEqual(missingSheetFilters(requiredFilters), ['drawtext', 'tile']);
    assert.deepEqual(missingSheetFilters([...requiredFilters, 'drawtext']), ['tile']);
    const problems = describeFfmpegGaps(requiredFilters, requiredEncoders);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /missing the filters drawtext, tile that contact sheets \(sheet\) need; the lanes still run/);
  });
});

describe('ffmpegVersion, ffmpegFilters and ffmpegEncoders through a runner', () => {
  it('run ffmpeg with -version, -filters and -encoders and parse the output', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe', ['-version']), okResult(versionOutput));
    runner.expect(matchProgram('ffmpeg.exe', ['-hide_banner', '-filters']), okResult(filtersOutput));
    runner.expect(matchProgram('ffmpeg.exe', ['-hide_banner', '-encoders']), okResult(encodersOutput));
    const ffmpeg = join('C:\\ffmpeg\\bin', 'ffmpeg.exe');
    assert.equal(await ffmpegVersion(runner, ffmpeg, never), '9.0.2-full_build-www.gyan.dev');
    assert.ok((await ffmpegFilters(runner, ffmpeg, never)).includes('xfade'));
    assert.ok((await ffmpegEncoders(runner, ffmpeg, never)).includes('pcm_s16le'));
    runner.assertAllUsed();
    assert.ok(runner.invocations.every((spec) => spec.label === 'ffmpeg'));
  });

  it('label each run after the executable, so an ffprobe error names ffprobe', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffprobe.exe', ['-version']), okResult('ffprobe version 9.0.2-full_build-www.gyan.dev Copyright'));
    assert.equal(await ffmpegVersion(runner, join('C:\\ffmpeg\\bin', 'ffprobe.exe'), never), '9.0.2-full_build-www.gyan.dev');
    assert.equal(runner.invocations[0]?.label, 'ffprobe');
    assert.equal(queryLabel('/usr/bin/ffmpeg'), 'ffmpeg');
    assert.equal(queryLabel(join('C:\\Tools', 'FFPROBE.EXE')), 'ffprobe');
  });

  it('treat a failing ffmpeg as no version and no filters', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), failedResult(1, 'broken'));
    runner.expect(matchProgram('ffmpeg.exe'), failedResult(1, 'broken'));
    assert.equal(await ffmpegVersion(runner, 'C:\\ffmpeg\\bin\\ffmpeg.exe', never), undefined);
    assert.deepEqual(await ffmpegFilters(runner, 'C:\\ffmpeg\\bin\\ffmpeg.exe', never), []);
  });
});

describe('the installed ffmpeg', () => {
  const ffmpeg = findFfmpeg();

  it('offers every required filter and encoder', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, async () => {
    const runner = new ChildProcessRunner();
    const path = ffmpeg?.path ?? '';
    const version = await ffmpegVersion(runner, path, never);
    assert.ok(version !== undefined && /^\d+\.\d+/.test(version), `version ${version}`);
    assert.deepEqual(missingFilters(await ffmpegFilters(runner, path, never)), []);
    assert.deepEqual(missingEncoders(await ffmpegEncoders(runner, path, never)), []);
  });
});
