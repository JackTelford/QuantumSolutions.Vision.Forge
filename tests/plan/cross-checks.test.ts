import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crossDocumentProblems, crossDocumentWarnings, crossProblemRules, crossWarningRules, shotStartFrames, transitionAfter } from '../../src/plan/cross-checks.ts';
import type { PlanDocuments } from '../../src/plan/cross-checks.ts';
import { planDocuments, planDocumentsWith } from './fixtures.ts';

function problems(documents: PlanDocuments): readonly string[] {
  return crossDocumentProblems(documents.brief, documents.treatment, documents.shotSpec, documents.look);
}

function warnings(documents: PlanDocuments): readonly string[] {
  return crossDocumentWarnings(documents.brief, documents.treatment, documents.shotSpec, documents.look);
}

/** Fails unless exactly one sentence matches the pattern. */
function assertOne(sentences: readonly string[], pattern: RegExp): void {
  const matching = sentences.filter((sentence) => pattern.test(sentence));
  assert.equal(matching.length, 1, `expected one sentence matching ${pattern}, got: ${JSON.stringify(sentences)}`);
}

describe('crossDocumentProblems', () => {
  it('runs seven problem rules and five warning rules', () => {
    assert.equal(crossProblemRules.length, 7);
    assert.equal(crossWarningRules.length, 5);
  });

  it('accepts the fixture quartet with no problem and no warning', () => {
    assert.deepEqual(problems(planDocuments()), []);
    assert.deepEqual(warnings(planDocuments()), []);
  });

  it('reports a treatment that answers another brief', () => {
    assertOne(problems(planDocumentsWith((d) => { d.treatment.briefId = 'other'; })), /treatment "obsidian-bottle-t1" answers brief "other", not the brief "obsidian-bottle" given/);
  });

  it('reports a shot spec whose brief, treatment or look id disagrees', () => {
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.briefId = 'other'; })), /shot spec .* serves brief "other"/);
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.treatmentId = 'other'; })), /comes from treatment "other", not the treatment "obsidian-bottle-t1"/);
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.lookId = 'other'; })), /shot spec .* uses look "other", not the look bible "obsidian"/);
  });

  it('reports a treatment whose look id is not the look bible given', () => {
    assertOne(problems(planDocumentsWith((d) => { d.treatment.lookId = 'noir'; })), /treatment .* uses look "noir", not the look bible "obsidian"/);
  });

  it('reports fps and frame size that differ from the brief', () => {
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.fps = 25; })), /shot spec fps 25 differs from the brief's 30/);
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.width = 1280; d.shotSpec.height = 720; })), /shot spec frame 1280x720 differs from the brief's 1920x1080/);
  });

  it('reports a beat that names a shot the spec does not have', () => {
    assertOne(problems(planDocumentsWith((d) => { d.treatment.beats[1]?.shotIds.push('s09'); })), /beat "b2" names shot "s09", which the shot spec does not have/);
  });

  it('reports a beat whose lane is not the lane of a shot it names', () => {
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.shots[0]!.lane = 'blender'; })), /beat "b1" is planned on the three lane but its shot "s01" is on the blender lane/);
  });

  it('reports a shot that belongs to no beat, and one that belongs to two', () => {
    assertOne(problems(planDocumentsWith((d) => { d.treatment.beats[1]!.shotIds = []; })), /shot "s03" belongs to no beat/);
    assertOne(problems(planDocumentsWith((d) => { d.treatment.beats[1]?.shotIds.unshift('s02'); })), /shot "s02" belongs to 2 beats \("b1", "b2"\), not exactly one/);
  });

  it('reports beats that list the shots in another order than the spec', () => {
    const swapped = planDocumentsWith((d) => { d.treatment.beats[0]!.shotIds = ['s02', 's01']; });
    assert.deepEqual(problems(swapped), ['the beats list the shots as s02, s01, s03, but the shot spec orders them s01, s02, s03']);
  });

  it('reports a transition after a missing shot or after the last shot', () => {
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.transitions[0]!.afterShotId = 's09'; })), /transition after "s09" names a shot that does not exist/);
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.transitions[1]!.afterShotId = 's03'; })), /transition after "s03" follows the last shot/);
  });

  it('reports a transition longer than a neighbour (pacing rule 1) and accepts one as long as the shorter neighbour', () => {
    assertOne(problems(planDocumentsWith((d) => { d.shotSpec.transitions[0]!.frames = 91; })), /dissolve after "s01" is 91 frames, longer than "s01" \(105\) or "s02" \(90\)/);
    const exact = planDocumentsWith((d) => { d.shotSpec.transitions[0]!.frames = 90; });
    assert.equal(problems(exact).some((problem) => /longer than/.test(problem)), false);
  });

  it('reports two non-cut transitions in a row only when one of the three shots they touch is under 2 s (pacing rule 2)', () => {
    const twoDissolves = planDocumentsWith((d) => { d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'dissolve', frames: 15 }; });
    assert.equal(problems(twoDissolves).some((problem) => /in a row/.test(problem)), false);
    const shortMiddle = planDocumentsWith((d) => {
      d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'dissolve', frames: 15 };
      d.shotSpec.shots[1]!.durationFrames = 45;
    });
    assertOne(problems(shortMiddle), /dissolve after "s01" and dissolve after "s02" are two non-cut transitions in a row on shots under 2 s: "s02" \(1\.5 s\)/);
    const shortFirst = planDocumentsWith((d) => {
      d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'dissolve', frames: 15 };
      d.shotSpec.shots[0]!.durationFrames = 45;
    });
    assertOne(problems(shortFirst), /two non-cut transitions in a row on shots under 2 s: "s01" \(1\.5 s\)$/);
    const shortThird = planDocumentsWith((d) => {
      d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'dissolve', frames: 15 };
      d.shotSpec.shots[2]!.durationFrames = 45;
    });
    assertOne(problems(shortThird), /two non-cut transitions in a row on shots under 2 s: "s03" \(1\.5 s\)$/);
    const shortFirstAndThird = planDocumentsWith((d) => {
      d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'dissolve', frames: 15 };
      d.shotSpec.shots[0]!.durationFrames = 45;
      d.shotSpec.shots[2]!.durationFrames = 30;
    });
    assertOne(problems(shortFirstAndThird), /under 2 s: "s01" \(1\.5 s\) and "s03" \(1\.0 s\)$/);
  });

  it('reports a total more than half a second from the brief, naming both numbers, and accepts exactly half a second', () => {
    assertOne(problems(planDocumentsWith((d) => { d.brief.durationSeconds = 12; })), /the shots total 300 frames \(10\.0 s\) after transitions, but the brief asks for 12 s \(360 frames\)/);
    assert.deepEqual(problems(planDocumentsWith((d) => { d.brief.durationSeconds = 10.5; })), []);
    assertOne(problems(planDocumentsWith((d) => { d.brief.durationSeconds = 10.6; })), /the brief asks for 10\.6 s/);
  });
});

describe('crossDocumentWarnings', () => {
  it('warns about a beat more than half a second from its shots, and not about one within', () => {
    assertOne(warnings(planDocumentsWith((d) => { d.treatment.beats[1]!.durationSeconds = 5; })), /beat "b2" is planned at 5 s but its shots sum to 120 frames \(4\.0 s\)/);
    assert.deepEqual(warnings(planDocumentsWith((d) => { d.treatment.beats[1]!.durationSeconds = 4.4; })), []);
  });

  it('warns about a product film with two dissolves', () => {
    assertOne(warnings(planDocumentsWith((d) => { d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'dissolve', frames: 15 }; })), /at most one dissolve; this one has 2/);
  });

  it('warns about a product film that ends on a move, unless a fade-black leads into the last shot', () => {
    const moving = planDocumentsWith((d) => { d.shotSpec.shots[2]!.move.preset = 'push-in'; });
    assertOne(warnings(moving), /ends on a fade-black or a hold; the last shot "s03" moves with push-in/);
    const faded = planDocumentsWith((d) => {
      d.shotSpec.shots[2]!.move.preset = 'push-in';
      d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'fade-black', frames: 20 };
    });
    assert.deepEqual(warnings(faded), []);
    assert.deepEqual(warnings(planDocumentsWith((d) => { d.shotSpec.shots[2]!.move.preset = 'breathe'; })), []);
  });

  it('warns about a title sequence without a fade-black into its last shot', () => {
    assertOne(warnings(planDocumentsWith((d) => { d.brief.useCase = 'title-sequence'; })), /a title sequence ends on a fade-black/);
    const faded = planDocumentsWith((d) => {
      d.brief.useCase = 'title-sequence';
      d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'fade-black', frames: 20 };
    });
    assert.deepEqual(warnings(faded), []);
  });

  it('warns about a cut, a dissolve or a fade-white across a lighting change, and not about a fade-black (pacing rule 4)', () => {
    assertOne(warnings(planDocumentsWith((d) => { d.shotSpec.shots[2]!.lighting.preset = 'rim-only'; })), /the cut after "s02" crosses a change of lighting rig \(product-studio to rim-only\); only a fade-black hides a rig change/);
    const fadedToWhite = planDocumentsWith((d) => {
      d.shotSpec.shots[2]!.lighting.preset = 'rim-only';
      d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'fade-white', frames: 15 };
    });
    assertOne(warnings(fadedToWhite), /the fade-white after "s02" crosses a change of lighting rig/);
    const fadedToBlack = planDocumentsWith((d) => {
      d.shotSpec.shots[2]!.lighting.preset = 'rim-only';
      d.shotSpec.transitions[1] = { afterShotId: 's02', type: 'fade-black', frames: 20 };
    });
    assert.deepEqual(warnings(fadedToBlack), []);
  });

  it('warns about narrationFirst when the brief has narration off, and not when it is on', () => {
    assertOne(warnings(planDocumentsWith((d) => { d.treatment.narrationFirst = true; })), /narrationFirst, but the brief has narration disabled/);
    assert.deepEqual(warnings(planDocumentsWith((d) => { d.treatment.narrationFirst = true; d.brief.narration.enabled = true; })), []);
  });
});

describe('shotStartFrames', () => {
  it('starts each shot where the previous ended minus the non-cut overlap', () => {
    const { shotSpec } = planDocuments();
    assert.deepEqual(shotStartFrames(shotSpec), [0, 90, 180]);
    assert.deepEqual(transitionAfter(shotSpec, 's03'), { afterShotId: 's03', type: 'cut', frames: 0 });
  });
});
