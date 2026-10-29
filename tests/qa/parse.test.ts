import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBlackdetect, parseEbur128Summary, parseFreezedetect, parsePsnrSummary, parseSignalstatsYavg, parseSsimStats, parseSsimSummary } from '../../src/qa/parse.ts';

const blackdetectLog = 'frame=  105 fps=0.0\n[Parsed_blackdetect_0 @ 0000024e1eb2c700] black_start:1 black_end:1.5 black_duration:0.5\n[Parsed_blackdetect_0 @ 0000024e1eb2c700] black_start:2.5 black_end:3 black_duration:0.5\n';

const freezedetectLog = [
  '[Parsed_freezedetect_0 @ 000001d779acbc80] lavfi.freezedetect.freeze_start: 1',
  '[Parsed_freezedetect_0 @ 000001d779acbc80] lavfi.freezedetect.freeze_duration: 0.5',
  '[Parsed_freezedetect_0 @ 000001d779acbc80] lavfi.freezedetect.freeze_end: 1.5',
  '[Parsed_freezedetect_0 @ 000001d779acbc80] lavfi.freezedetect.freeze_start: 1.5',
].join('\n');

const ssimStats = [
  'n:1 Y:1.000000 U:1.000000 V:1.000000 All:1.000000 (inf)',
  'n:2 Y:0.913684 U:0.921799 V:0.898718 All:0.912542 (10.582008)',
  'n:31 Y:0.254471 U:0.457107 V:0.415623 All:0.315102 (1.643742)',
].join('\n');

const yavgLog = 'frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=120.818\nframe:1    pts:512     pts_time:0.0333333\nlavfi.signalstats.YAVG=16\n';

const ebur128Log = [
  '[Parsed_ebur128_0 @ 1] t: 0.1 TARGET:-23 LUFS    M: -70.0 S: -70.0     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -12.3 dBFS  TPK: -12.3 dBFS',
  '[Parsed_ebur128_0 @ 1] Summary:',
  '',
  '  Integrated loudness:',
  '    I:         -16.0 LUFS',
  '    Threshold: -26.0 LUFS',
  '',
  '  Loudness range:',
  '    LRA:        20.0 LU',
  '',
  '  True peak:',
  '    Peak:      -12.3 dBFS',
].join('\n');

describe('ffmpeg output parsers', () => {
  it('reads every black segment from blackdetect lines', () => {
    assert.deepEqual(parseBlackdetect(blackdetectLog), [{ start: 1, end: 1.5 }, { start: 2.5, end: 3 }]);
    assert.deepEqual(parseBlackdetect('nothing here'), []);
  });

  it('pairs freeze starts with ends and closes an open freeze at the stream end', () => {
    assert.deepEqual(parseFreezedetect(freezedetectLog, 3.5), [{ start: 1, end: 1.5 }, { start: 1.5, end: 3.5 }]);
    assert.deepEqual(parseFreezedetect('', 3.5), []);
  });

  it('indexes per-frame SSIM from 0 although the stats file counts from 1', () => {
    const values = parseSsimStats(ssimStats);
    assert.equal(values[0], 1);
    assert.equal(values[1], 0.912542);
    assert.equal(values[30], 0.315102);
    assert.equal(values[2], undefined);
  });

  it('reads the luma average of each frame from the metadata print file', () => {
    assert.deepEqual(parseSignalstatsYavg(yavgLog), [120.818, 16]);
    assert.deepEqual(parseSignalstatsYavg(''), []);
  });

  it('reads integrated loudness and true peak from the summary, not from the per-frame lines', () => {
    assert.deepEqual(parseEbur128Summary(ebur128Log), { integrated: -16, truePeak: -12.3 });
    assert.equal(parseEbur128Summary('no summary at all'), undefined);
  });

  it('maps -inf levels to negative infinity', () => {
    const silent = parseEbur128Summary('Summary:\n    I:         -inf LUFS\n    Peak:      -inf dBFS\n');
    assert.equal(silent?.integrated, Number.NEGATIVE_INFINITY);
    assert.equal(silent?.truePeak, Number.NEGATIVE_INFINITY);
  });

  it('reads the average PSNR from the summary line, infinity for identical frames', () => {
    assert.equal(parsePsnrSummary('[Parsed_psnr_0 @ 1] PSNR r:inf g:inf b:99.256854 average:104.028066 min:104.028066 max:104.028066\n'), 104.028066);
    assert.equal(parsePsnrSummary('[Parsed_psnr_0 @ 1] PSNR r:inf g:inf b:inf average:inf min:inf max:inf\n'), Number.POSITIVE_INFINITY);
    assert.equal(parsePsnrSummary('frame=1 fps=0.0'), undefined);
  });

  it('reads the overall SSIM from the summary line', () => {
    assert.equal(parseSsimSummary('[Parsed_ssim_3 @ 1] SSIM R:0.331256 (1.747402) G:0.368403 (1.995602) B:0.337243 (1.786459) All:0.345634 (1.841795)\n'), 0.345634);
    assert.equal(parseSsimSummary('[Parsed_ssim_3 @ 1] not matching timebases found'), undefined);
  });
});
