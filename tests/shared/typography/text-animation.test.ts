import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TextAnimation } from '../../../src/shared/contracts/shot-spec.ts';
import { TextAnimationValues } from '../../../src/shared/contracts/shot-spec.ts';
import { ease } from '../../../src/shared/motion/easing.ts';
import { counterText, entranceFrames, exitFrames, hiddenState, shownState, splitWords, textAnimationDurationsMs, textAnimationEasings, textState, textTiming, wordDelayFrames } from '../../../src/shared/typography/text-animation.ts';

const fps = 30;
const height = 1080;

function element(animation: TextAnimation, inFrame = 12, outFrame: number | null = 110, staggerMs = 60): { animation: TextAnimation; inFrame: number; outFrame: number | null; staggerMs: number } {
  return { animation, inFrame, outFrame, staggerMs };
}

describe('text animation timing', () => {
  it('knows a duration and an easing for every animation', () => {
    assert.deepEqual(Object.keys(textAnimationDurationsMs).sort(), [...TextAnimationValues].sort());
    assert.deepEqual(Object.keys(textAnimationEasings).sort(), [...TextAnimationValues].sort());
  });

  it('turns the reference durations into frames: fade-rise 450 ms is 14 frames in and 9 out at 30 fps', () => {
    assert.equal(entranceFrames('fade-rise', fps), 14);
    assert.equal(exitFrames('fade-rise', fps), 9);
    assert.equal(entranceFrames('counter', fps), 36);
    assert.equal(entranceFrames('none', fps), 0);
    assert.equal(wordDelayFrames('stagger-words', 60, fps), 2);
    assert.equal(wordDelayFrames('fade-rise', 60, fps), 0);
  });

  it('places the entrance at inFrame and the exit just before outFrame', () => {
    assert.deepEqual(textTiming(element('fade-rise'), fps), { enterStart: 12, enterEnd: 26, exitStart: 101, exitEnd: 110 });
    assert.deepEqual(textTiming(element('fade-rise', 12, null), fps), { enterStart: 12, enterEnd: 26, exitStart: null, exitEnd: null });
    assert.deepEqual(textTiming(element('stagger-words'), fps, 3), { enterStart: 18, enterEnd: 32, exitStart: 101, exitEnd: 110 });
  });

  it('never starts the exit before the entrance has finished', () => {
    const timing = textTiming(element('tracking-in', 0, 20), fps);
    assert.equal(timing.enterEnd, 24);
    assert.equal(timing.exitStart, 24);
  });
});

describe('textState', () => {
  it('is hidden before inFrame and from outFrame on, shown in between', () => {
    const text = element('fade-rise');
    assert.deepEqual(textState(text, 11, fps, height), hiddenState);
    assert.equal(textState(text, 60, fps, height).opacity, 1);
    assert.equal(textState(text, 60, fps, height).phase, 'hold');
    assert.equal(textState(text, 110, fps, height).opacity, 0);
    assert.equal(textState(text, 110, fps, height).phase, 'after');
  });

  it('eases fade-rise in with emphasized-decelerate from 24 px below', () => {
    const text = element('fade-rise');
    const start = textState(text, 12, fps, height);
    assert.equal(start.opacity, 0);
    assert.equal(start.translateYPx, 24);
    const mid = textState(text, 19, fps, height);
    const p = ease('emphasized-decelerate', 7 / 14);
    assert.ok(Math.abs(mid.opacity - p) < 1e-12);
    assert.ok(Math.abs(mid.translateYPx - (1 - p) * 24) < 1e-9);
    assert.equal(mid.phase, 'entering');
    assert.equal(textState(text, 26, fps, height).opacity, 1);
  });

  it('scales its pixel values with the frame height', () => {
    assert.equal(textState(element('fade-rise'), 12, fps, 2160).translateYPx, 48);
    assert.equal(textState(element('blur-in'), 12, fps, 540).blurPx, 4);
  });

  it('exits by mirroring the entrance with standard-accelerate over two thirds of the duration', () => {
    const text = element('fade-rise');
    const first = textState(text, 101, fps, height);
    assert.equal(first.phase, 'exiting');
    assert.equal(first.opacity, 1);
    const late = textState(text, 107, fps, height);
    const p = 1 - ease('standard-accelerate', 6 / 9);
    assert.ok(Math.abs(late.opacity - p) < 1e-12);
    assert.ok(late.translateYPx > 0);
  });

  it('models each animation on its own property', () => {
    assert.equal(textState(element('blur-in'), 12, fps, height).blurPx, 8);
    assert.equal(textState(element('blur-in'), 12, fps, height).opacity, 0);
    assert.equal(textState(element('mask-wipe'), 12, fps, height).revealFraction, 0);
    assert.equal(textState(element('mask-wipe'), 12, fps, height).opacity, 1);
    assert.ok(Math.abs(textState(element('tracking-in'), 12, fps, height).trackingEmExtra - 0.3) < 1e-12);
    assert.equal(textState(element('counter'), 12, fps, height).counterFraction, 0);
    assert.equal(textState(element('counter'), 48, fps, height).counterFraction, 1);
    assert.deepEqual(textState(element('none'), 12, fps, height), shownState);
    assert.deepEqual(textState(element('none'), 11, fps, height), hiddenState);
  });

  it('delays each word of stagger-words by the stagger', () => {
    const text = element('stagger-words', 12, null, 60);
    assert.equal(textState(text, 12, fps, height, 0).phase, 'entering');
    assert.equal(textState(text, 12, fps, height, 1).phase, 'before');
    assert.equal(textState(text, 14, fps, height, 1).phase, 'entering');
  });

  it('is monotonic through the entrance for every animation', () => {
    for (const animation of TextAnimationValues as readonly TextAnimation[]) {
      const text = element(animation, 0, null);
      let previous = -1;
      for (let frame = 0; frame <= entranceFrames(animation, fps); frame += 1) {
        const state = textState(text, frame, fps, height);
        const progress = animation === 'mask-wipe' ? state.revealFraction : animation === 'counter' ? state.counterFraction : state.opacity;
        assert.ok(progress >= previous - 1e-12, `${animation} frame ${frame}`);
        previous = progress;
      }
      assert.deepEqual(textState(text, entranceFrames(animation, fps) + 5, fps, height), shownState);
    }
  });
});

describe('words and counters', () => {
  it('splits words on whitespace', () => {
    assert.deepEqual(splitWords('  Now in  500 ml '), ['Now', 'in', '500', 'ml']);
    assert.deepEqual(splitWords(''), []);
  });

  it('counts the digits of the content up to the target, keeping prefix, suffix and grouping', () => {
    assert.equal(counterText('1,250 units', 0), '0 units');
    assert.equal(counterText('1,250 units', 0.5), '625 units');
    assert.equal(counterText('1,250 units', 1), '1,250 units');
    assert.equal(counterText('$48', 0.25), '$12');
    assert.equal(counterText('no digits', 0.5), 'no digits');
  });
});
