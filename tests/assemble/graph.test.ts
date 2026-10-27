import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { joinClips, secondsText, transitionAfter, xfadeNames } from '../../src/assemble/graph.ts';
import { totalFrames } from '../../src/schema/checks/assembly-plan.ts';
import type { AssemblyPlan, Clip, Transition, TransitionTypeValues } from '../../src/shared/contracts/assembly-plan.ts';

function clip(id: string, durationFrames: number): Clip {
  return { id, source: { kind: 'frames', path: `C:\\vf\\${id}\\f%04d.png`, startNumber: 1 }, durationFrames };
}

function plan(clips: readonly Clip[], transitions: readonly Transition[]): AssemblyPlan {
  return {
    kind: 'assembly-plan',
    version: 1,
    fps: 30,
    width: 320,
    height: 180,
    clips: [...clips],
    transitions: [...transitions],
    output: { path: 'C:\\vf\\out\\film.mp4', codec: 'h264', crf: 16, preset: 'medium', faststart: true },
  };
}

describe('xfadeNames', () => {
  it('names an ffmpeg transition for every TransitionType but cut', () => {
    const expected: Record<Exclude<(typeof TransitionTypeValues)[number], 'cut'>, string> = {
      dissolve: 'dissolve', 'fade-black': 'fadeblack', 'fade-white': 'fadewhite', 'wipe-left': 'wipeleft', 'wipe-right': 'wiperight',
      'wipe-up': 'wipeup', 'wipe-down': 'wipedown', 'slide-left': 'slideleft', 'slide-right': 'slideright',
    };
    assert.deepEqual(xfadeNames, expected);
  });
});

describe('secondsText', () => {
  it('prints frames as seconds with up to six decimals and no trailing zeros', () => {
    assert.equal(secondsText(10, 30), '0.333333');
    assert.equal(secondsText(30, 30), '1');
    assert.equal(secondsText(45, 30), '1.5');
    assert.equal(secondsText(0, 30), '0');
  });
});

describe('joinClips', () => {
  it('adds nothing for a single clip and points at its label', () => {
    assert.deepEqual(joinClips(plan([clip('a', 30)], [])), { filters: [], label: '[c0]' });
  });

  it('joins two clips with a cut by concat followed by fps', () => {
    assert.deepEqual(joinClips(plan([clip('a', 30), clip('b', 30)], [])), { filters: ['[c0][c1]concat=n=2:v=1:a=0,fps=30[vout]'], label: '[vout]' });
    assert.deepEqual(joinClips(plan([clip('a', 30), clip('b', 30)], [{ afterClipId: 'a', type: 'cut', frames: 5 }])).filters, ['[c0][c1]concat=n=2:v=1:a=0,fps=30[vout]']);
  });

  it('joins two clips with a dissolve by xfade whose offset is the first clip minus the overlap', () => {
    const joined = joinClips(plan([clip('a', 30), clip('b', 30)], [{ afterClipId: 'a', type: 'dissolve', frames: 10 }]));
    assert.deepEqual(joined, { filters: ['[c0][c1]xfade=transition=dissolve:duration=0.333333:offset=0.666667[vout]'], label: '[vout]' });
  });

  it('folds three clips left with a cut then a wipe, accumulating the joined length', () => {
    const three = plan([clip('a', 30), clip('b', 30), clip('c', 30)], [{ afterClipId: 'b', type: 'wipe-left', frames: 15 }]);
    assert.deepEqual(joinClips(three), {
      filters: ['[c0][c1]concat=n=2:v=1:a=0,fps=30[j1]', '[j1][c2]xfade=transition=wipeleft:duration=0.5:offset=1.5[vout]'],
      label: '[vout]',
    });
    assert.equal(totalFrames(three), 75);
  });

  it('subtracts earlier overlaps from later offsets', () => {
    const three = plan([clip('a', 30), clip('b', 30), clip('c', 30)], [{ afterClipId: 'a', type: 'wipe-left', frames: 15 }, { afterClipId: 'b', type: 'fade-black', frames: 15 }]);
    assert.deepEqual(joinClips(three).filters, [
      '[c0][c1]xfade=transition=wipeleft:duration=0.5:offset=0.5[j1]',
      '[j1][c2]xfade=transition=fadeblack:duration=0.5:offset=1[vout]',
    ]);
    assert.equal(totalFrames(three), 60);
  });
});

describe('transitionAfter', () => {
  it('treats a cut entry and a missing entry alike', () => {
    const two = plan([clip('a', 30), clip('b', 30)], [{ afterClipId: 'a', type: 'cut', frames: 1 }]);
    assert.equal(transitionAfter(two, 'a'), undefined);
    assert.equal(transitionAfter(two, 'b'), undefined);
    const dissolve = plan([clip('a', 30), clip('b', 30)], [{ afterClipId: 'a', type: 'dissolve', frames: 8 }]);
    assert.deepEqual(transitionAfter(dissolve, 'a'), { afterClipId: 'a', type: 'dissolve', frames: 8 });
  });
});
