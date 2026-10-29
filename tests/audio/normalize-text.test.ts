import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decimalToWords, integerToWords, maxSentenceCharacters, normalizeNarrationText, ordinalToWords, splitSentences, yearToWords } from '../../src/audio/normalize-text.ts';

describe('integerToWords', () => {
  it('spells integers the British way with "and" after the hundreds', () => {
    assert.equal(integerToWords(0), 'zero');
    assert.equal(integerToWords(7), 'seven');
    assert.equal(integerToWords(21), 'twenty-one');
    assert.equal(integerToWords(100), 'one hundred');
    assert.equal(integerToWords(105), 'one hundred and five');
    assert.equal(integerToWords(500), 'five hundred');
    assert.equal(integerToWords(1_000), 'one thousand');
    assert.equal(integerToWords(1_024), 'one thousand and twenty-four');
    assert.equal(integerToWords(12_345), 'twelve thousand three hundred and forty-five');
    assert.equal(integerToWords(2_000_000), 'two million');
  });

  it('refuses negatives, fractions and anything a trillion or more', () => {
    assert.throws(() => integerToWords(-1), RangeError);
    assert.throws(() => integerToWords(1.5), RangeError);
    assert.throws(() => integerToWords(1_000_000_000_000), RangeError);
  });
});

describe('yearToWords, decimalToWords and ordinalToWords', () => {
  it('reads years in pairs except the two thousands', () => {
    assert.equal(yearToWords(1999), 'nineteen ninety-nine');
    assert.equal(yearToWords(1900), 'nineteen hundred');
    assert.equal(yearToWords(2005), 'two thousand and five');
    assert.equal(yearToWords(2026), 'twenty twenty-six');
    assert.equal(yearToWords(2010), 'twenty ten');
  });

  it('reads decimals digit by digit after "point"', () => {
    assert.equal(decimalToWords('3.14'), 'three point one four');
    assert.equal(decimalToWords('0.5'), 'zero point five');
    assert.equal(decimalToWords('12'), 'twelve');
  });

  it('forms ordinals including the irregular ones', () => {
    assert.equal(ordinalToWords(1), 'first');
    assert.equal(ordinalToWords(2), 'second');
    assert.equal(ordinalToWords(3), 'third');
    assert.equal(ordinalToWords(4), 'fourth');
    assert.equal(ordinalToWords(12), 'twelfth');
    assert.equal(ordinalToWords(20), 'twentieth');
    assert.equal(ordinalToWords(21), 'twenty-first');
    assert.equal(ordinalToWords(100), 'one hundredth');
  });
});

describe('normalizeNarrationText', () => {
  it('spells out quantities with units, keeping the plural right', () => {
    assert.equal(normalizeNarrationText('Now in 500 ml.'), 'Now in five hundred millilitres.');
    assert.equal(normalizeNarrationText('Just 1 kg and 2.5 km.'), 'Just one kilogram and two point five kilometres.');
    assert.equal(normalizeNarrationText('Runs at 60fps on 8 GB.'), 'Runs at sixty frames per second on eight gigabytes.');
  });

  it('reads currency, percent, ordinals, years and plain numbers', () => {
    assert.equal(normalizeNarrationText('$5 or $12.50, 20% off.'), 'five dollars or twelve dollars and fifty cents, twenty percent off.');
    assert.equal(normalizeNarrationText('The 2nd model since 1999 sold 12,000 units.'), 'The second model since nineteen ninety-nine sold twelve thousand units.');
  });

  it('expands abbreviations and symbols, and leaves ordinary words alone', () => {
    assert.equal(normalizeNarrationText('Dr. Lee & Mr. Ray, e.g. at 20°C.'), 'doctor Lee and mister Ray, for example at twenty degrees Celsius.');
    assert.equal(normalizeNarrationText('A premium bottle, made well.'), 'A premium bottle, made well.');
    assert.equal(normalizeNarrationText('Tea vs. coffee, etc.'), 'Tea versus. coffee, et cetera.');
  });

  it('collapses whitespace and is idempotent on normalized text', () => {
    const once = normalizeNarrationText('Now  in\n500 ml .');
    assert.equal(once, 'Now in five hundred millilitres.');
    assert.equal(normalizeNarrationText(once), once);
  });
});

describe('splitSentences', () => {
  it('cuts at sentence ends and drops empty pieces', () => {
    assert.deepEqual(splitSentences('One. Two! Three? "Four."  '), ['One.', 'Two!', 'Three?', '"Four."']);
    assert.deepEqual(splitSentences('   '), []);
  });

  it('does not cut after an abbreviation followed by a lowercase word, nor inside a decimal', () => {
    assert.deepEqual(splitSentences('Version 2.5 ships soon. It is good.'), ['Version 2.5 ships soon.', 'It is good.']);
  });

  it('cuts a sentence over the cap at the last comma or space before it, never inside a word', () => {
    const long = `${'word '.repeat(120).trim()}, ${'more '.repeat(20).trim()}.`;
    const pieces = splitSentences(long, 200);
    assert.ok(pieces.length >= 3);
    for (const piece of pieces) {
      assert.ok(piece.length <= 200, `piece of ${String(piece.length)} characters`);
      assert.ok(!piece.startsWith(' ') && !piece.endsWith(' '));
    }
    assert.equal(pieces.join(' ').replaceAll(' ,', ','), long);
    assert.ok(maxSentenceCharacters < 509);
  });
});
