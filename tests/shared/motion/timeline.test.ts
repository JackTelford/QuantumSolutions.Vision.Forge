import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ease, springResponse } from '../../../src/shared/motion/easing.ts';
import {
  Timeline,
  delay,
  interpolate,
  loop,
  moveSegment,
  segment,
  segmentEndFrame,
  sequence,
  spring,
  stagger,
} from '../../../src/shared/motion/timeline.ts';

/** Floating-point slack for values that are exact in theory. */
const exactEpsilon = 1e-9;

function assertClose(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= exactEpsilon, `${label}: ${actual} is not within ${exactEpsilon} of ${expected}`);
}

describe('interpolate', () => {
  it('maps the frame range linearly onto the value range by default', () => {
    assertClose(interpolate(10, [10, 20], [0, 100]), 0, 'start');
    assertClose(interpolate(15, [10, 20], [0, 100]), 50, 'middle');
    assertClose(interpolate(20, [10, 20], [0, 100]), 100, 'end');
    assertClose(interpolate(15, [10, 20], [100, 0]), 50, 'descending output');
  });

  it('holds the end values outside the range in clamp mode', () => {
    assertClose(interpolate(0, [10, 20], [5, 9]), 5, 'before');
    assertClose(interpolate(30, [10, 20], [5, 9]), 9, 'after');
    assertClose(interpolate(30, [10, 20], [5, 9], { extrapolate: 'clamp' }), 9, 'explicit clamp');
  });

  it('continues the straight line outside the range in extend mode', () => {
    assertClose(interpolate(0, [10, 20], [0, 100], { extrapolate: 'extend' }), -100, 'before');
    assertClose(interpolate(25, [10, 20], [0, 100], { extrapolate: 'extend' }), 150, 'after');
  });

  it('extends the un-eased straight line even when the inside is eased', () => {
    assertClose(interpolate(15, [0, 10], [0, 1], { extrapolate: 'extend', easing: 'ease-out' }), 1.5, 'after, un-eased');
    assertClose(interpolate(-5, [0, 10], [0, 1], { extrapolate: 'extend', easing: 'ease-out' }), -0.5, 'before, un-eased');
    assertClose(interpolate(5, [0, 10], [0, 1], { extrapolate: 'extend', easing: 'ease-out' }), ease('ease-out', 0.5), 'inside, eased');
  });

  it('returns the frame itself outside the range in identity mode', () => {
    assert.equal(interpolate(3, [10, 20], [0, 100], { extrapolate: 'identity' }), 3);
    assert.equal(interpolate(27, [10, 20], [0, 100], { extrapolate: 'identity' }), 27);
    assertClose(interpolate(15, [10, 20], [0, 100], { extrapolate: 'identity' }), 50, 'inside');
  });

  it('eases the progress with the token before mapping it', () => {
    const eased = interpolate(15, [10, 20], [0, 100], { easing: 'ease' });
    assertClose(eased, 100 * ease('ease', 0.5), 'ease at the midpoint');
    assertClose(interpolate(15, [10, 20], [0, 100], { easing: 'sine-in-out' }), 50, 'sine-in-out is symmetric');
  });

  it('refuses an input range that does not ascend', () => {
    assert.throws(() => interpolate(0, [20, 10], [0, 1]), RangeError);
    assert.throws(() => interpolate(0, [10, 10], [0, 1]), RangeError);
  });
});

describe('spring', () => {
  const options = { from: 10, to: 20, startFrame: 12, fps: 30 };

  it('rests at from before the start frame and at the start frame', () => {
    assert.equal(spring(0, options), 10);
    assert.equal(spring(12, options), 10);
  });

  it('follows the canonical response over the elapsed seconds', () => {
    const frame = 21;
    const expected = 10 + 10 * springResponse((frame - 12) / 30);
    assertClose(spring(frame, options), expected, 'frame 21');
  });

  it('settles within a tenth of a percent of the travel at to', () => {
    const settleEpsilon = 0.01;
    assert.ok(Math.abs(spring(12 + 60, options) - 20) <= settleEpsilon, `two seconds in: ${spring(72, options)}`);
  });

  it('refuses a frame rate that is not positive instead of answering NaN', () => {
    assert.throws(() => spring(20, { ...options, fps: 0 }), RangeError);
    assert.throws(() => spring(20, { ...options, fps: -30 }), RangeError);
    assert.throws(() => spring(20, { ...options, fps: Number.NaN }), RangeError);
    assert.throws(() => spring(0, { ...options, fps: 0 }), RangeError, 'even before the start frame');
  });
});

describe('segment', () => {
  it('holds from before the window, eases inside it and holds to from the end on', () => {
    const rise = segment(10, 20, 0, 1, 'linear');
    assert.equal(rise.valueAt(0), 0);
    assert.equal(rise.valueAt(10), 0);
    assertClose(rise.valueAt(15), 0.25, 'quarter');
    assert.equal(rise.valueAt(30), 1);
    assert.equal(rise.valueAt(99), 1);
    assert.equal(segmentEndFrame(rise), 30);
  });

  it('applies the easing token to the progress', () => {
    const rise = segment(0, 10, 0, 100, 'ease-in');
    assertClose(rise.valueAt(5), 100 * ease('ease-in', 0.5), 'midpoint');
  });

  it('refuses a fractional start or a duration under one frame', () => {
    assert.throws(() => segment(1.5, 10, 0, 1, 'linear'), RangeError);
    assert.throws(() => segment(0, 0, 0, 1, 'linear'), RangeError);
  });
});

describe('moveSegment', () => {
  it('keeps the shape of the value over the window', () => {
    const moved = moveSegment(segment(10, 20, 0, 1, 'linear'), 40);
    assert.equal(moved.startFrame, 40);
    assert.equal(moved.durationFrames, 20);
    assert.equal(moved.valueAt(39), 0);
    assertClose(moved.valueAt(45), 0.25, 'quarter');
    assert.equal(moved.valueAt(60), 1);
  });
});

describe('sequence', () => {
  it('starts each segment after the previous one plus the gap', () => {
    const [a, b, c] = sequence([segment(5, 10, 0, 1, 'linear'), segment(0, 4, 1, 0, 'linear'), delay(6, 1)], 2);
    assert.deepEqual([a?.startFrame, b?.startFrame, c?.startFrame], [5, 17, 23]);
    assert.deepEqual([a?.durationFrames, b?.durationFrames, c?.durationFrames], [10, 4, 6]);
    assertClose(b?.valueAt(19) ?? -1, 0.5, 'the moved segment keeps its shape');
  });

  it('runs segments back to back without a gap by default', () => {
    const [, b] = sequence([segment(0, 10, 0, 1, 'linear'), segment(0, 10, 0, 1, 'linear')]);
    assert.equal(b?.startFrame, 10);
  });

  it('keeps the list of segments empty when nothing is given', () => {
    assert.deepEqual(sequence([], 3), []);
  });
});

describe('stagger', () => {
  it('gives one progress segment per item offset by the stagger', () => {
    const items = stagger(3, 12, 2, 30);
    assert.deepEqual(items.map((item) => item.startFrame), [30, 32, 34]);
    assert.deepEqual(items.map((item) => item.durationFrames), [12, 12, 12]);
    assertClose(items[2]?.valueAt(40) ?? -1, 0.5, 'the third item halfway');
    assert.equal(items[0]?.valueAt(42), 1);
  });

  it('animates the values and easing the options name', () => {
    const [only] = stagger(1, 10, 0, 0, { from: 24, to: 0, easing: 'ease-out' });
    assert.equal(only?.valueAt(0), 24);
    assertClose(only?.valueAt(5) ?? -1, 24 - 24 * ease('ease-out', 0.5), 'midpoint');
    assert.equal(only?.valueAt(10), 0);
  });

  it('gives no segments for zero items and refuses a negative count', () => {
    assert.deepEqual(stagger(0, 10, 2, 0), []);
    assert.throws(() => stagger(-1, 10, 2, 0), RangeError);
  });

  it('validates the duration and the start frame even when the count is zero', () => {
    assert.throws(() => stagger(0, 0, 2, 0), RangeError, 'zero duration');
    assert.throws(() => stagger(0, 2.5, 2, 0), RangeError, 'fractional duration');
    assert.throws(() => stagger(0, 10, 2, 1.5), RangeError, 'fractional start frame');
    assert.throws(() => stagger(0, 10, 0.5, 0), RangeError, 'fractional offset');
  });
});

describe('delay', () => {
  it('occupies frames and holds one value', () => {
    const hold = delay(15, 0.5);
    assert.equal(hold.startFrame, 0);
    assert.equal(hold.durationFrames, 15);
    assert.equal(hold.valueAt(-5), 0.5);
    assert.equal(hold.valueAt(7), 0.5);
    assert.equal(hold.valueAt(100), 0.5);
    assert.equal(delay(1).valueAt(0), 0);
  });

  it('refuses a hold under one frame', () => {
    assert.throws(() => delay(0), RangeError);
  });
});

describe('loop', () => {
  it('repeats the segment cycle by cycle and holds the end value afterwards', () => {
    const turn = loop(segment(10, 20, 0, 360, 'linear'), 3);
    assert.equal(turn.startFrame, 10);
    assert.equal(turn.durationFrames, 60);
    assert.equal(turn.valueAt(0), 0);
    assertClose(turn.valueAt(15), 90, 'first cycle');
    assert.equal(turn.valueAt(30), 0);
    assertClose(turn.valueAt(35), 90, 'second cycle');
    assertClose(turn.valueAt(69), 342, 'last frame of the last cycle');
    assert.equal(turn.valueAt(70), 360);
    assert.equal(turn.valueAt(500), 360);
  });

  it('refuses zero repetitions', () => {
    assert.throws(() => loop(segment(0, 10, 0, 1, 'linear'), 0), RangeError);
  });
});

describe('Timeline', () => {
  const timeline = new Timeline({ fps: 30, events: { n1: 0, n2: 45, n3: 120 } });

  it('answers the frame of a named event', () => {
    assert.equal(timeline.fps, 30);
    assert.equal(timeline.at('n2'), 45);
    assert.deepEqual(timeline.eventNames(), ['n1', 'n2', 'n3']);
  });

  it('throws a RangeError for an unknown event name', () => {
    assert.throws(() => timeline.at('n9'), RangeError);
    assert.throws(() => timeline.at('toString'), RangeError);
  });

  it('measures the frames between two events, negative when reversed', () => {
    assert.equal(timeline.between('n1', 'n3'), 120);
    assert.equal(timeline.between('n3', 'n2'), -75);
  });

  it('builds a segment that starts at an event', () => {
    const caption = timeline.segmentFromEvent('n2', 12, 0, 1, 'linear');
    assert.equal(caption.startFrame, 45);
    assertClose(caption.valueAt(51), 0.5, 'midpoint');
  });

  it('refuses events at fractional or negative frames', () => {
    assert.throws(() => new Timeline({ fps: 30, events: { bad: 1.5 } }), RangeError);
    assert.throws(() => new Timeline({ fps: 30, events: { bad: -1 } }), RangeError);
  });

  it('refuses a frame rate that is not positive', () => {
    assert.throws(() => new Timeline({ fps: 0, events: {} }), RangeError);
    assert.throws(() => new Timeline({ fps: -24, events: {} }), RangeError);
    assert.throws(() => new Timeline({ fps: Number.NaN, events: {} }), RangeError);
  });
});
