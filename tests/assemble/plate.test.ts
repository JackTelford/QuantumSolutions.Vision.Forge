import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allOverlayInputArguments, allPlateFilters, clipPlateFilters, gradedLabel, overlayFilter, overlayInputArguments, overlayInputIndex, overlayLabel, overlayOf, planJoinFormat, platedLabel, videoInputCount } from '../../src/assemble/plate.ts';
import type { AssemblyPlan, Clip } from '../../src/shared/contracts/assembly-plan.ts';

const overlay = { kind: 'frames' as const, path: 'C:\\vf\\cache\\t1\\frames\\f%06d.png', startNumber: 0 };
const bare: Clip = { id: 'a', source: { kind: 'frames', path: 'C:\\vf\\a\\f%04d.png', startNumber: 1 }, durationFrames: 30 };
const plated: Clip = { ...bare, id: 'b', source: { kind: 'frames', path: 'C:\\vf\\b\\f%04d.png', startNumber: 1 }, overlay };
const nulled: Clip = { ...bare, id: 'c', overlay: null };

function plan(clips: readonly Clip[], grade?: AssemblyPlan['grade']): AssemblyPlan {
  return {
    kind: 'assembly-plan', version: 1, fps: 30, width: 320, height: 180, clips: [...clips], transitions: [],
    output: { path: 'C:\\vf\\out\\film.mp4', codec: 'h264', crf: 16, preset: 'medium', faststart: true },
    ...(grade === undefined ? {} : { grade }),
  };
}

describe('overlayOf', () => {
  it('treats a null overlay and an absent one alike', () => {
    assert.equal(overlayOf(bare), undefined);
    assert.equal(overlayOf(nulled), undefined);
    assert.deepEqual(overlayOf(plated), overlay);
  });
});

describe('overlay inputs', () => {
  it('reads a text plate like a frames source at the plan rate from its first number', () => {
    assert.deepEqual(overlayInputArguments(overlay, 30), ['-framerate', '30', '-start_number', '0', '-i', overlay.path]);
  });

  it('numbers the overlays after every clip, in clip order, and the audio after them', () => {
    const three = plan([bare, plated, { ...plated, id: 'd' }]);
    assert.equal(videoInputCount(three), 5);
    assert.equal(overlayInputIndex(three, 1), 3);
    assert.equal(overlayInputIndex(three, 2), 4);
    assert.throws(() => overlayInputIndex(three, 0), RangeError);
    assert.deepEqual(allOverlayInputArguments(three), [...overlayInputArguments(overlay, 30), ...overlayInputArguments(overlay, 30)]);
    assert.equal(videoInputCount(plan([bare, nulled])), 2);
    assert.deepEqual(allOverlayInputArguments(plan([bare, nulled])), []);
  });
});

describe('clipPlateFilters', () => {
  it('without a grade or an overlay takes the normalized clip into 16-bit RGB once and keeps it there for the join, under the plated label', () => {
    assert.equal(planJoinFormat(plan([bare])), 'format=gbrp16le');
    assert.deepEqual(clipPlateFilters(plan([bare]), bare, 0), ['[c0]format=gbrp16le[p0]']);
    assert.equal(platedLabel(2), '[p2]');
    assert.equal(gradedLabel(2), '[g2]');
    assert.equal(overlayLabel(2), '[o2]');
  });

  it('grades each clip on its own with the LUT and the vignette, without grain, joining in 8-bit RGB since the vignette already is', () => {
    const graded = plan([bare], { cubePath: 'C:\\vf\\film.cube', vignetteAmount: 0.25, vignetteSoftness: 0.5, grainAmount: 0.15, grainSeed: 7 });
    assert.equal(planJoinFormat(graded), 'format=gbrp');
    assert.deepEqual(clipPlateFilters(graded, bare, 0), ["[c0]format=gbrp16le,lut3d=file='C\\:/vf/film.cube':interp=tetrahedral,format=rgb24,vignette=angle=PI/10,format=gbrp[p0]"]);
  });

  it('keeps a LUT-only grade in 16-bit RGB through the join, with no format step after the LUT', () => {
    const lutOnly = plan([bare], { cubePath: 'C:\\vf\\film.cube', vignetteAmount: 0, vignetteSoftness: 0.5, grainAmount: 0.15, grainSeed: 7 });
    assert.equal(planJoinFormat(lutOnly), 'format=gbrp16le');
    assert.deepEqual(clipPlateFilters(lutOnly, bare, 0), ["[c0]format=gbrp16le,lut3d=file='C\\:/vf/film.cube':interp=tetrahedral[p0]"]);
  });

  it('lays the text plate over the graded picture of a clip with an overlay, the plate kept in rgba and cut to the clip, and joins every clip of the plan in 8-bit RGB', () => {
    const two = plan([bare, plated]);
    assert.equal(planJoinFormat(two), 'format=gbrp');
    assert.equal(overlayFilter(two, plated, 1), '[2:v]format=rgba,fps=30,trim=end_frame=30,setpts=PTS-STARTPTS,fps=30[o1]');
    assert.deepEqual(clipPlateFilters(two, plated, 1), [
      '[c1]format=gbrp16le,format=gbrp[g1]',
      '[2:v]format=rgba,fps=30,trim=end_frame=30,setpts=PTS-STARTPTS,fps=30[o1]',
      '[g1][o1]overlay=format=auto,format=gbrp[p1]',
    ]);
    assert.deepEqual(allPlateFilters(two), ['[c0]format=gbrp16le,format=gbrp[p0]', ...clipPlateFilters(two, plated, 1)]);
  });
});
