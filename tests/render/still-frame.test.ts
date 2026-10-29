import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultStillFrame, elementEnterEnd, lastTextEnterEnd } from '../../src/render/still-frame.ts';
import type { Shot, TextElement } from '../../src/shared/contracts/shot-spec.ts';
import { textTiming, wordDelayFrames } from '../../src/shared/typography/text-animation.ts';
import { mutated, shotExample, textExample } from '../schema/documents/examples.ts';

const fps = 30;

function text(changes: Partial<TextElement>): TextElement {
  return { ...textExample, ...changes };
}

function shot(change: (copy: Shot) => void): Shot {
  return mutated(shotExample('s01', 120, 'html'), change);
}

describe('defaultStillFrame', () => {
  it('judges a text shot on the frame the last element has finished entering', () => {
    const late = text({ id: 't2', inFrame: 40, animation: 'blur-in' });
    const withText = shot((copy) => { copy.text = [textExample, late]; copy.move = { preset: 'static-hold', amplitude: 0, easing: 'linear', startFrame: 0, endFrame: null }; });
    assert.equal(lastTextEnterEnd(withText, fps), textTiming(late, fps).enterEnd);
    assert.equal(defaultStillFrame(withText, fps), 40 + 15);
  });

  it('waits for the last word of a stagger-words element, which enters after the first by the word delay times the words before it', () => {
    const staggered = text({ id: 't3', inFrame: 20, animation: 'stagger-words', staggerMs: 80, content: 'five words enter one after' });
    const wordZeroEnd = textTiming(staggered, fps).enterEnd;
    const expected = wordZeroEnd + 4 * wordDelayFrames('stagger-words', 80, fps);
    assert.ok(expected > wordZeroEnd, 'the stagger moves the end');
    assert.equal(elementEnterEnd(staggered, fps), expected);
    const noWords = text({ animation: 'stagger-words', staggerMs: 80, content: '   ' });
    assert.equal(elementEnterEnd(noWords, fps), textTiming(noWords, fps).enterEnd, 'no words: word 0 timing');
    const withStagger = shot((copy) => { copy.text = [textExample, staggered]; copy.move = { preset: 'static-hold', amplitude: 0, easing: 'linear', startFrame: 0, endFrame: null }; });
    assert.equal(defaultStillFrame(withStagger, fps), expected);
  });

  it('judges a moving shot without text on the last frame of its move window', () => {
    const toTheEnd = shot((copy) => { copy.text = []; });
    assert.equal(defaultStillFrame(toTheEnd, fps), 119);
    const early = shot((copy) => { copy.text = []; copy.move = { ...copy.move, startFrame: 10, endFrame: 70 }; });
    assert.equal(defaultStillFrame(early, fps), 69);
  });

  it('judges a static shot without text in the middle', () => {
    const still = shot((copy) => { copy.text = []; copy.move = { preset: 'static-hold', amplitude: 0, easing: 'linear', startFrame: 0, endFrame: null }; });
    assert.equal(defaultStillFrame(still, fps), 59);
    assert.equal(defaultStillFrame(mutated(still, (copy) => { copy.durationFrames = 1; }), fps), 0);
  });

  it('never leaves the shot: a text entrance that ends after the last frame is clamped', () => {
    const lateText = shot((copy) => { copy.text = [text({ inFrame: 115, outFrame: null, animation: 'counter' })]; });
    assert.equal(defaultStillFrame(lateText, fps), 119);
  });
});
