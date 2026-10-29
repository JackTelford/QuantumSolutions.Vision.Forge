import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultVoice, findOfferedVoice, gradeRank, kokoroEnglishVoices, offeredFloor, offeredGradeFloor, offeredVoices, reachesGrade } from '../../src/audio/voices.ts';
import type { KokoroVoice } from '../../src/audio/voices.ts';

describe('the grade ladder', () => {
  it('ranks A+ above A above A- and so on down to F, with an unknown grade below everything', () => {
    assert.ok(gradeRank('A+') < gradeRank('A'));
    assert.ok(gradeRank('A') < gradeRank('A-'));
    assert.ok(gradeRank('A-') < gradeRank('B+'));
    assert.ok(gradeRank('B-') < gradeRank('C+'));
    assert.ok(gradeRank('D-') < gradeRank('F+'));
    assert.ok(gradeRank('?') > gradeRank('F'));
    assert.equal(reachesGrade('B', 'B'), true);
    assert.equal(reachesGrade('A-', 'B'), true);
    assert.equal(reachesGrade('B-', 'B'), false);
    assert.equal(reachesGrade('B-', 'B-'), true);
  });

  it('keeps the floor at B when six voices reach it and lowers it to B- otherwise', () => {
    const voice = (name: string, grade: string): KokoroVoice => ({ name, gender: 'female', accent: 'american', grade });
    const six = ['A', 'A', 'B+', 'B', 'B', 'B'].map((grade, index) => voice(`af_${index}`, grade));
    assert.equal(offeredGradeFloor(six), 'B');
    assert.equal(offeredGradeFloor(six.slice(0, 5)), 'B-');
    assert.equal(offeredGradeFloor([]), 'B-');
  });
});

describe('the voices of kokoro-js 1.2.1', () => {
  it('lists the 28 English voices, each an a* or b* id with a known grade', () => {
    assert.equal(kokoroEnglishVoices.length, 28);
    assert.equal(new Set(kokoroEnglishVoices.map((voice) => voice.name)).size, 28);
    for (const voice of kokoroEnglishVoices) {
      assert.match(voice.name, /^[ab][fm]_[a-z]+$/, voice.name);
      assert.equal(voice.accent, voice.name.startsWith('a') ? 'american' : 'british', voice.name);
      assert.equal(voice.gender, voice.name[1] === 'f' ? 'female' : 'male', voice.name);
      assert.ok(gradeRank(voice.grade) < gradeRank('?'), `${voice.name} has the unknown grade ${voice.grade}`);
    }
  });

  it('offers the voices graded B- or better, because only two reach B', () => {
    assert.equal(offeredFloor, 'B-');
    assert.equal(kokoroEnglishVoices.filter((voice) => reachesGrade(voice.grade, 'B')).length, 2);
    assert.deepEqual(offeredVoices.map((voice) => [voice.name, voice.grade]), [['af_heart', 'A'], ['af_bella', 'A-'], ['af_nicole', 'B-'], ['bf_emma', 'B-']]);
  });

  it('offers the default, and every offered voice is American or British English', () => {
    assert.equal(defaultVoice, 'af_heart');
    assert.ok(offeredVoices.some((voice) => voice.name === defaultVoice));
    assert.ok(offeredVoices.every((voice) => voice.name.startsWith('a') || voice.name.startsWith('b')));
    assert.equal(findOfferedVoice('af_heart')?.grade, 'A');
    assert.equal(findOfferedVoice('am_adam'), undefined, 'graded F+, never offered');
    assert.equal(findOfferedVoice('zz_nobody'), undefined);
  });
});
