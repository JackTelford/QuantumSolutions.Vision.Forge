import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFrameAt } from '../../../src/shared/camera/bake.ts';
import type { CameraFrame } from '../../../src/shared/camera/types.ts';
import {
  compositionProblems,
  cameraAboveFloor,
  compositionWarnings,
  focusWarnings,
  hasOrphan,
  headroomEpsilon,
  maxCharactersPerLine,
  textHeightFloorsPx,
} from '../../../src/shared/composition/checks.ts';
import { solveBasePose } from '../../../src/shared/composition/solver.ts';
import type { Shot } from '../../../src/shared/contracts/shot-spec.ts';
import { makeShot, makeText, problemsAbout, renderSpec } from './fixtures.ts';

/** Frame 0 of the solved pose, a static hold. */
function solvedFrame(shot: Shot): CameraFrame {
  return cameraFrameAt(shot, renderSpec, solveBasePose(shot, renderSpec), 0);
}

/** The problems of the shot at frame 0 of its solved pose. */
function problemsOf(shot: Shot): readonly string[] {
  return compositionProblems(shot, renderSpec, solvedFrame(shot));
}

describe('compositionProblems', () => {
  it('passes every check for a well-formed MS hero with a title on the right', () => {
    assert.deepEqual(problemsOf(makeShot({ text: [makeText()] })), []);
  });

  it('reports a text box on the subject as an overlap', () => {
    const onSubject = makeText({ box: { x: 0.25, y: 0.3, w: 0.2, h: 0.1 } });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [onSubject] })), 'overlaps the subject box').length, 1);
  });

  it('reports a text box outside title safe', () => {
    const outside = makeText({ box: { x: 0.6, y: 0.9, w: 0.3, h: 0.08 } });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [outside] })), 'title-safe').length, 1);
  });

  it('fails a 20 px caption at 1080p and passes a 24 px one', () => {
    const small = makeText({ role: 'caption', content: 'Made in Portugal', box: { x: 0.55, y: 0.6, w: 0.3, h: 20 / 1080 } });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [small] })), 'px tall').length, 1);
    const atFloor = makeText({ role: 'caption', content: 'Made in Portugal', box: { x: 0.55, y: 0.6, w: 0.3, h: 24 / 1080 } });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [atFloor] })), 'px tall').length, 0);
  });

  it('scales the floor with the frame height: 20 px fails at 1080p but its 4K double passes', () => {
    const spec4k = { fps: 30, width: 3840, height: 2160 };
    const caption = makeText({ role: 'caption', content: 'Made in Portugal', box: { x: 0.55, y: 0.6, w: 0.3, h: 48 / 2160 } });
    const shot = makeShot({ text: [caption] });
    assert.equal(problemsAbout(compositionProblems(shot, spec4k, solvedFrame(shot)), 'px tall').length, 0);
    assert.equal(textHeightFloorsPx.title, 72);
    assert.equal(textHeightFloorsPx.body, 32);
    assert.equal(textHeightFloorsPx.caption, 24);
  });

  it('takes the subtitle, lower-third and counter floors from the typography scale', () => {
    assert.equal(textHeightFloorsPx.subtitle, 56);
    assert.equal(textHeightFloorsPx['lower-third-name'], 44);
    assert.equal(textHeightFloorsPx['lower-third-title'], 28);
    assert.equal(textHeightFloorsPx.counter, 96);
    const shortSubtitle = makeText({ role: 'subtitle', content: 'Cold brewed', box: { x: 0.55, y: 0.6, w: 0.3, h: 48 / 1080 } });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [shortSubtitle] })), 'px tall').length, 1);
  });

  it('fails a 4-line body', () => {
    const body = makeText({ role: 'body', content: 'One\nTwo words\nThree more words\nFour', box: { x: 0.55, y: 0.4, w: 0.35, h: 0.2 } });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [body] })), 'lines; at most 3').length, 1);
  });

  it('fails a title with 50 characters on one line and allows 42', () => {
    const long = makeText({ content: 'x'.repeat(50) });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [long] })), 'characters; at most 42').length, 1);
    const fits = makeText({ content: 'x'.repeat(42) });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [fits] })), 'characters').length, 0);
    assert.equal(maxCharactersPerLine('subtitle'), 42);
    assert.equal(maxCharactersPerLine('caption'), 60);
  });

  it('counts characters as code points, so 41 letters and an emoji fit a title line of 42', () => {
    const withEmoji = makeText({ content: `${'x'.repeat(41)}\u{1F600}` });
    assert.equal(withEmoji.content.length, 43, 'UTF-16 code units');
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [withEmoji] })), 'characters').length, 0);
    const accented = makeText({ content: 'naïve café' });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [accented] })), 'characters').length, 0);
  });

  it('reports a single word alone on the last line', () => {
    const orphaned = makeText({ content: 'Now in five hundred\nmillilitres' });
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [orphaned] })), 'single word').length, 1);
    assert.equal(hasOrphan(['Now in five hundred', 'millilitres']), true);
    assert.equal(hasOrphan(['Now in', 'five hundred ml']), false);
    assert.equal(hasOrphan(['millilitres']), false);
  });

  it('reports headroom outside the range for an MS asked for 20 percent', () => {
    const tooMuch = makeShot({ composition: { anchor: 'thirds-left', headroomPct: 20, leadRoomPct: 15, textSide: 'right' } });
    assert.equal(problemsAbout(problemsOf(tooMuch), 'headroom').length, 1);
    assert.equal(problemsAbout(problemsOf(makeShot({ size: 'FS', composition: { anchor: 'center', headroomPct: 20, leadRoomPct: 0, textSide: 'none' } })), 'headroom').length, 0);
  });

  it('passes check 4 at the range edges: MS at 8 and 12 percent and CU at 12 percent', () => {
    const edges: ReadonlyArray<{ size: Shot['size']; headroomPct: number }> = [
      { size: 'MS', headroomPct: 8 },
      { size: 'MS', headroomPct: 12 },
      { size: 'CU', headroomPct: 12 },
    ];
    for (const edge of edges) {
      const shot = makeShot({ size: edge.size, composition: { anchor: 'thirds-left', headroomPct: edge.headroomPct, leadRoomPct: 15, textSide: 'right' } });
      assert.deepEqual(problemsAbout(problemsOf(shot), 'headroom'), [], `${edge.size} at ${edge.headroomPct} percent`);
    }
    assert.ok(headroomEpsilon > 0 && headroomEpsilon < 1e-3, 'the tolerance is a hair of the frame height');
  });

  it('passes every check for a well-formed ECU macro, where check 1 is skipped', () => {
    const macro = makeShot({
      size: 'ECU',
      lens: { focalMm: 100, fStop: 2.8, focusDistanceM: 0.6, shutterAngleDeg: 180 },
      composition: { anchor: 'center', headroomPct: 0, leadRoomPct: 0, textSide: 'none' },
    });
    assert.deepEqual(problemsOf(macro), []);
  });

  it('reports the subject off the grid and leaving action safe once a 10 degree pan has swung the view away from it', () => {
    const panned = makeShot({
      move: { preset: 'pan-left', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: null },
      composition: { anchor: 'thirds-right', headroomPct: 10, leadRoomPct: 15, textSide: 'left' },
    });
    const pose = solveBasePose(panned, renderSpec);
    assert.deepEqual(compositionProblems(panned, renderSpec, cameraFrameAt(panned, renderSpec, pose, 0)), [], 'the first frame is the solved framing');
    const problems = compositionProblems(panned, renderSpec, cameraFrameAt(panned, renderSpec, pose, panned.durationFrames - 1));
    assert.equal(problemsAbout(problems, 'grid point').length, 1, problems.join('\n'));
    assert.equal(problemsAbout(problems, 'action-safe').length, 1, problems.join('\n'));
  });

  it('is pure: the same inputs give the same sentences', () => {
    const shot = makeShot({ text: [makeText({ content: 'x'.repeat(50) }), makeText({ id: 't2', role: 'caption', box: { x: 0.2, y: 0.3, w: 0.1, h: 0.01 } })] });
    assert.deepEqual(problemsOf(shot), problemsOf(shot));
    assert.deepEqual(compositionWarnings(shot), compositionWarnings(shot));
  });
});

describe('compositionWarnings', () => {
  it('warns when a second text box is larger than a third of the largest and stays quiet otherwise', () => {
    const title = makeText();
    const competing = makeText({ id: 't2', role: 'subtitle', box: { x: 0.55, y: 0.55, w: 0.35, h: 0.05 } });
    assert.equal(compositionWarnings(makeShot({ text: [title, competing] })).length, 1);
    const modest = makeText({ id: 't2', role: 'caption', box: { x: 0.55, y: 0.55, w: 0.3, h: 0.03 } });
    assert.deepEqual(compositionWarnings(makeShot({ text: [title, modest] })), []);
    assert.deepEqual(compositionWarnings(makeShot({ text: [title] })), []);
  });
});

describe('cameraAboveFloor', () => {
  it('reports a low angle whose camera sits under the stage floor, naming the height, and passes an eye-level camera', () => {
    const low = makeShot({ angle: 'low', subject: { ...makeShot({}).subject, boundsM: { w: 0.06, h: 0.16, d: 0.06 } } });
    const lowProblems = cameraAboveFloor(low, solvedFrame(low));
    assert.equal(lowProblems.length, 1, lowProblems.join('; '));
    assert.match(lowProblems[0] ?? '', /below the stage floor at this angle .* raise the angle to eye/);
    assert.deepEqual(cameraAboveFloor(makeShot({}), solvedFrame(makeShot({}))), []);
    assert.ok(problemsOf(low).some((problem) => /below the stage floor/.test(problem)), 'the check is one of the composition problems');
  });
});

describe('focusWarnings', () => {
  it('warns when the lens focuses well in front of the solved subject distance and names the distance to set', () => {
    const shot = makeShot({ lens: { focalMm: 85, fStop: 2.8, focusDistanceM: 0.9, shutterAngleDeg: 180 } });
    const distanceM = solveBasePose(shot, renderSpec).distanceM;
    const warnings = focusWarnings(shot, renderSpec);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]?.includes(`Set lens.focusDistanceM to ${distanceM.toFixed(2)}`), warnings[0]);
  });

  it('stays quiet when the lens focuses on the subject, and for a rack-focus move', () => {
    const shot = makeShot({});
    const focused = { ...shot, lens: { ...shot.lens, focusDistanceM: solveBasePose(shot, renderSpec).distanceM } };
    assert.deepEqual(focusWarnings(focused, renderSpec), []);
    const racked = { ...shot, lens: { ...shot.lens, focusDistanceM: 0.9 }, move: { ...shot.move, preset: 'rack-focus' as const } };
    assert.deepEqual(focusWarnings(racked, renderSpec), []);
  });
});

describe('an undrawn subject', () => {
  it('frames the camera but blocks no text and may leave action safe when the primitive is none', () => {
    const onSubject = makeText({ box: { x: 0.25, y: 0.3, w: 0.2, h: 0.1 } });
    const undrawn = makeShot({ text: [onSubject], subject: { assetId: null, primitive: 'none', boundsM: { w: 0.24, h: 0.3, d: 0.02 } } });
    assert.equal(problemsAbout(problemsOf(undrawn), 'overlaps the subject box').length, 0);
    assert.equal(problemsAbout(problemsOf(undrawn), 'action-safe').length, 0);
    assert.equal(problemsAbout(problemsOf(makeShot({ text: [onSubject] })), 'overlaps the subject box').length, 1);
  });
});
