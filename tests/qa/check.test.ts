import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CancelledError, DataFileError, ProcessFailedError } from '../../src/errors/vision-forge-error.ts';
import { describeFrameRuns, describeFrames, frameToSecondsText, framesOutside, runsOf, secondsToFrame, unmeasured } from '../../src/qa/check.ts';

describe('check helpers', () => {
  it('convert between seconds and frames and print seconds with two decimals', () => {
    assert.equal(secondsToFrame(1.5, 30), 45);
    assert.equal(secondsToFrame(-0.2, 30), 0);
    assert.equal(frameToSecondsText(45, 30), '1.50 s');
    assert.equal(frameToSecondsText(0, 30), '0.00 s');
  });

  it('group sorted frames into contiguous runs', () => {
    assert.deepEqual(runsOf([]), []);
    assert.deepEqual(runsOf([30]), [{ start: 30, end: 31 }]);
    assert.deepEqual(runsOf([30, 31, 32, 40, 41, 50]), [{ start: 30, end: 33 }, { start: 40, end: 42 }, { start: 50, end: 51 }]);
  });

  it('describe runs with one "frame" or "frames" prefix', () => {
    assert.equal(describeFrames({ start: 30, end: 31 }), 'frame 30');
    assert.equal(describeFrames({ start: 30, end: 45 }), 'frames 30-44');
    assert.equal(describeFrameRuns([30]), 'frame 30');
    assert.equal(describeFrameRuns([30, 31, 32, 33, 34]), 'frames 30-34');
    assert.equal(describeFrameRuns([30, 31, 32, 33, 34, 40, 41, 42, 43, 44]), 'frames 30-34, 40-44');
    assert.equal(describeFrameRuns([30, 40, 41]), 'frames 30, 40-41');
  });

  it('list the frames of a range that no excluded range covers', () => {
    assert.deepEqual(framesOutside({ start: 30, end: 45 }, [{ start: 35, end: 40 }]), [30, 31, 32, 33, 34, 40, 41, 42, 43, 44]);
    assert.deepEqual(framesOutside({ start: 30, end: 45 }, [{ start: 28, end: 46 }]), []);
  });

  it('turn only measurement errors into a failed check and rethrow the rest', () => {
    const failed = unmeasured('pops', 'ssim', 0.6, new ProcessFailedError('ffmpeg ssim', 1, 'bad input', undefined, 'hint'));
    assert.deepEqual([failed.id, failed.ok, failed.measured, failed.threshold, failed.unit, failed.frames], ['pops', false, null, 0.6, 'ssim', []]);
    assert.match(failed.detail, /could not measure: ffmpeg ssim failed/);
    assert.equal(unmeasured('loudness', 'LUFS', -16, new DataFileError('x.wav', 'no summary', 'hint')).ok, false);
    assert.throws(() => unmeasured('pops', 'ssim', 0.6, new CancelledError()), CancelledError);
    assert.throws(() => unmeasured('pops', 'ssim', 0.6, new TypeError('programming error')), TypeError);
    assert.throws(() => unmeasured('pops', 'ssim', 0.6, 'a string'), /a string/);
  });
});
