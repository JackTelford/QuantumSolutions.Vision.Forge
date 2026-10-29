import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  captionLeadFrames,
  captionLeadFramesRange,
  captionTailFrames,
  captionWindow,
  containsNumber,
  readingHoldFrames,
  readingHoldSeconds,
  wordCount,
} from '../../../src/shared/motion/text-timing.ts';

/** Floating-point slack for sums of decimal fractions such as 10 × 0.3 + 0.8. */
const sumEpsilon = 1e-9;

const tenWords = 'the quick brown fox jumps over the lazy dog again';

describe('wordCount', () => {
  it('counts runs of non-whitespace characters', () => {
    assert.equal(wordCount(tenWords), 10);
    assert.equal(wordCount('  one   two\tthree\nfour  '), 4);
    assert.equal(wordCount(''), 0);
    assert.equal(wordCount('   '), 0);
  });
});

describe('containsNumber', () => {
  it('finds a digit anywhere in the text', () => {
    assert.equal(containsNumber('42 percent'), true);
    assert.equal(containsNumber('Now in 500 ml'), true);
    assert.equal(containsNumber('forty-two percent'), false);
  });

  it('counts digits of every script, not only ASCII', () => {
    assert.equal(containsNumber('٤٢ بالمئة'), true, 'Arabic-Indic 42');
    assert.equal(containsNumber('४२ प्रतिशत'), true, 'Devanagari 42');
    assert.equal(containsNumber('١'), true, 'a lone Arabic-Indic one');
    assert.equal(containsNumber('½ of the market'), false, 'the vulgar fraction half is not a decimal digit');
    assert.equal(containsNumber('Ⅲ of the market'), false, 'a Roman numeral is not a decimal digit');
  });
});

describe('readingHoldSeconds', () => {
  it('holds a ten-word line for 3.8 seconds', () => {
    assert.ok(Math.abs(readingHoldSeconds(tenWords) - 3.8) <= sumEpsilon, `${readingHoldSeconds(tenWords)}`);
  });

  it('holds one word for 1.1 seconds and empty text for the 0.8 second base', () => {
    assert.ok(Math.abs(readingHoldSeconds('Hello') - 1.1) <= sumEpsilon);
    assert.ok(Math.abs(readingHoldSeconds('') - 0.8) <= sumEpsilon);
  });

  it('holds a number for at least 2 seconds', () => {
    assert.equal(readingHoldSeconds('42 percent'), 2);
    const longWithNumber = 'ten words with a number 7 here take longer than two';
    assert.ok(Math.abs(readingHoldSeconds(longWithNumber) - 4.1) <= sumEpsilon, `${readingHoldSeconds(longWithNumber)}`);
  });
});

describe('readingHoldFrames', () => {
  it('rounds the hold to whole frames at the frame rate', () => {
    assert.equal(readingHoldFrames(tenWords, 30), 114);
    assert.equal(readingHoldFrames(tenWords, 24), 91);
    assert.equal(readingHoldFrames('42 percent', 25), 50);
    assert.equal(readingHoldFrames('Hello', 60), 66);
  });
});

describe('caption timing', () => {
  it('leads the sentence by 8 frames, inside the 6 to 10 the grammar allows, and trails it by 6', () => {
    assert.equal(captionLeadFrames, 8);
    assert.ok(captionLeadFrames >= captionLeadFramesRange.min && captionLeadFrames <= captionLeadFramesRange.max);
    assert.equal(captionTailFrames, 6);
  });

  it('places a caption window around its sentence and never before frame 0', () => {
    assert.deepEqual(captionWindow(45, 100), { inFrame: 37, outFrame: 106 });
    assert.deepEqual(captionWindow(3, 40), { inFrame: 0, outFrame: 46 });
  });
});
