import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSrt, formatSrtTime } from '../../src/audio/srt.ts';

describe('formatSrtTime', () => {
  it('writes hours, minutes, seconds and milliseconds with a comma', () => {
    assert.equal(formatSrtTime(0), '00:00:00,000');
    assert.equal(formatSrtTime(1.5), '00:00:01,500');
    assert.equal(formatSrtTime(61.0075), '00:01:01,008');
    assert.equal(formatSrtTime(3_600 + 125.25), '01:02:05,250');
  });

  it('refuses negative and non-finite times', () => {
    assert.throws(() => formatSrtTime(-1), RangeError);
    assert.throws(() => formatSrtTime(Number.NaN), RangeError);
  });
});

describe('formatSrt', () => {
  it('numbers the cues from one, separates them with a blank line and ends with one', () => {
    const srt = formatSrt([
      { startSeconds: 0.8, endSeconds: 2.3, text: 'Now in  five hundred millilitres.' },
      { startSeconds: 2.6, endSeconds: 4, text: 'Made well.' },
    ]);
    assert.equal(srt, '1\n00:00:00,800 --> 00:00:02,300\nNow in five hundred millilitres.\n\n2\n00:00:02,600 --> 00:00:04,000\nMade well.\n');
  });

  it('is empty for no cues and refuses a cue that ends before it starts', () => {
    assert.equal(formatSrt([]), '');
    assert.throws(() => formatSrt([{ startSeconds: 2, endSeconds: 1, text: 'x' }]), RangeError);
  });
});
