import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allClipFilters, allClipInputArguments, clipFilter, clipInputArguments, clipLabel } from '../../src/assemble/normalize.ts';
import type { AssemblyPlan, Clip } from '../../src/shared/contracts/assembly-plan.ts';

const frames: Clip = { id: 's01', source: { kind: 'frames', path: 'C:\\vf\\job\\s01\\f%06d.png', startNumber: 1 }, durationFrames: 90 };
const video: Clip = { id: 's02', source: { kind: 'video', path: 'C:\\vf\\job\\s02.mp4', startNumber: 0 }, durationFrames: 45 };

const plan: AssemblyPlan = {
  kind: 'assembly-plan',
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  clips: [frames, video],
  transitions: [],
  output: { path: 'C:\\vf\\out\\film.mp4', codec: 'h264', crf: 16, preset: 'medium', faststart: true },
};

describe('clipInputArguments', () => {
  it('reads a frames source at the plan rate from its first number', () => {
    assert.deepEqual(clipInputArguments(frames, 30), ['-framerate', '30', '-start_number', '1', '-i', 'C:\\vf\\job\\s01\\f%06d.png']);
  });

  it('reads a video source as is', () => {
    assert.deepEqual(clipInputArguments(video, 30), ['-i', 'C:\\vf\\job\\s02.mp4']);
  });
});

describe('clipFilter', () => {
  it('squares the pixels, scales inside the delivery to even sizes, pads with black, pins SAR 1:1, forces fps and yuv420p, trims to the length and restarts timestamps', () => {
    assert.equal(
      clipFilter(plan, frames, 0),
      '[0:v]scale=iw*sar:ih,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,trim=end_frame=90,setpts=PTS-STARTPTS[c0]',
    );
    assert.equal(
      clipFilter(plan, video, 1),
      '[1:v]scale=iw*sar:ih,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,trim=end_frame=45,setpts=PTS-STARTPTS[c1]',
    );
  });

  it('labels clips by their index', () => {
    assert.equal(clipLabel(3), '[c3]');
  });
});

describe('allClipInputArguments and allClipFilters', () => {
  it('number inputs and labels in plan order', () => {
    assert.deepEqual(allClipInputArguments(plan), ['-framerate', '30', '-start_number', '1', '-i', 'C:\\vf\\job\\s01\\f%06d.png', '-i', 'C:\\vf\\job\\s02.mp4']);
    const filters = allClipFilters(plan);
    assert.equal(filters.length, 2);
    assert.ok(filters[0]?.startsWith('[0:v]') && filters[0].endsWith('[c0]'));
    assert.ok(filters[1]?.startsWith('[1:v]') && filters[1].endsWith('[c1]'));
  });
});
