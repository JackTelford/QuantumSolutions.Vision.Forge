import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audioInputArguments, duckingFilter, hasAudio, loudnormApplyFilter, loudnormMeasureFilter, mixFormat, mixGraph, parseLoudnormJson, parseOutputIntegrated } from '../../src/assemble/audio.ts';
import type { AssemblyPlan, AudioMix } from '../../src/shared/contracts/assembly-plan.ts';

const narrationAndMusic: AudioMix = {
  narration: [{ path: 'C:\\vf\\job\\n1.wav', startFrame: 10 }, { path: 'C:\\vf\\job\\n2.wav', startFrame: 50 }],
  music: { path: 'C:\\vf\\job\\music.wav', duckUnderNarration: true, gainDb: -12 },
  loudnessLufs: -16,
  truePeakDbtp: -1.5,
};

function plan(audio: AudioMix | undefined): AssemblyPlan {
  return {
    kind: 'assembly-plan',
    version: 1,
    fps: 30,
    width: 320,
    height: 180,
    clips: [{ id: 'a', source: { kind: 'frames', path: 'C:\\vf\\a\\f%04d.png', startNumber: 1 }, durationFrames: 90 }],
    transitions: [],
    output: { path: 'C:\\vf\\out\\film.mp4', codec: 'h264', crf: 16, preset: 'medium', faststart: true },
    ...(audio === undefined ? {} : { audio }),
  };
}

describe('hasAudio', () => {
  it('is false without an audio section or with neither narration nor music', () => {
    assert.equal(hasAudio(plan(undefined)), false);
    assert.equal(hasAudio(plan({ narration: [], music: null, loudnessLufs: -16, truePeakDbtp: -1.5 })), false);
    assert.equal(hasAudio(plan(narrationAndMusic)), true);
  });
});

describe('audioInputArguments', () => {
  it('lists narration lines in order, then the music', () => {
    assert.deepEqual(audioInputArguments(narrationAndMusic), ['-i', 'C:\\vf\\job\\n1.wav', '-i', 'C:\\vf\\job\\n2.wav', '-i', 'C:\\vf\\job\\music.wav']);
    assert.deepEqual(audioInputArguments({ ...narrationAndMusic, music: null }), ['-i', 'C:\\vf\\job\\n1.wav', '-i', 'C:\\vf\\job\\n2.wav']);
  });
});

describe('mixGraph', () => {
  it('delays each line to its start frame, sums them, ducks the music under the padded narration key and fixes the length', () => {
    assert.equal(mixGraph(narrationAndMusic, 90, 30), [
      `[0:a]${mixFormat},adelay=333|333[n0]`,
      `[1:a]${mixFormat},adelay=1667|1667[n1]`,
      '[n0][n1]amix=inputs=2:normalize=0[nar]',
      `[2:a]${mixFormat},volume=-12dB[mus]`,
      '[nar]asplit=2[nar0][nar1]',
      '[nar1]apad=whole_dur=3[key]',
      `[mus][key]${duckingFilter}[duck]`,
      '[nar0][duck]amix=inputs=2:normalize=0[mixed]',
      '[mixed]apad=whole_dur=3,atrim=end=3,asetpts=PTS-STARTPTS[amix]',
    ].join(';'));
  });

  it('mixes narration and music plainly when ducking is off', () => {
    const graph = mixGraph({ ...narrationAndMusic, music: { path: 'C:\\vf\\job\\music.wav', duckUnderNarration: false, gainDb: -6 } }, 90, 30);
    assert.ok(graph.includes('[nar][mus]amix=inputs=2:normalize=0[mixed]'), graph);
    assert.ok(!graph.includes('sidechaincompress'), graph);
    assert.ok(graph.includes('volume=-6dB'), graph);
  });

  it('uses the narration alone or the music alone when the other is absent', () => {
    const narrationOnly = mixGraph({ ...narrationAndMusic, narration: [narrationAndMusic.narration[0] as AudioMix['narration'][number]], music: null }, 60, 30);
    assert.equal(narrationOnly, `[0:a]${mixFormat},adelay=333|333[n0];[n0]amix=inputs=1:normalize=0[nar];[nar]apad=whole_dur=2,atrim=end=2,asetpts=PTS-STARTPTS[amix]`);
    const musicOnly = mixGraph({ ...narrationAndMusic, narration: [] }, 60, 30);
    assert.equal(musicOnly, `[0:a]${mixFormat},volume=-12dB[mus];[mus]apad=whole_dur=2,atrim=end=2,asetpts=PTS-STARTPTS[amix]`);
  });
});

describe('loudnorm filters', () => {
  it('measure pass prints JSON for the plan targets', () => {
    assert.equal(loudnormMeasureFilter(narrationAndMusic), 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json');
  });

  it('apply pass carries every measured value, linear mode and a summary', () => {
    const measured = { inputI: '-26.53', inputTp: '-19.56', inputLra: '0.40', inputThresh: '-36.53', targetOffset: '-0.39' };
    assert.equal(loudnormApplyFilter(narrationAndMusic, measured), 'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-26.53:measured_TP=-19.56:measured_LRA=0.40:measured_thresh=-36.53:offset=-0.39:linear=true:print_format=summary');
  });
});

describe('parseLoudnormJson', () => {
  const block = '[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-26.53",\n\t"input_tp" : "-19.56",\n\t"input_lra" : "0.40",\n\t"input_thresh" : "-36.53",\n\t"output_i" : "-15.61",\n\t"output_tp" : "-8.78",\n\t"output_lra" : "0.00",\n\t"output_thresh" : "-25.61",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "-0.39"\n}\nsize=N/A time=00:00:03.00\n';

  it('reads the last JSON block out of ffmpeg standard error', () => {
    assert.deepEqual(parseLoudnormJson(block), { inputI: '-26.53', inputTp: '-19.56', inputLra: '0.40', inputThresh: '-36.53', targetOffset: '-0.39' });
  });

  it('returns undefined without a block, with broken JSON or with a non-numeric field', () => {
    assert.equal(parseLoudnormJson('nothing here'), undefined);
    assert.equal(parseLoudnormJson('{ "input_i": '), undefined);
    assert.equal(parseLoudnormJson(block.replace('"-19.56"', '"nope"')), undefined);
  });
});

describe('parseOutputIntegrated', () => {
  it('reads the output loudness from the pass-two summary', () => {
    assert.equal(parseOutputIntegrated('Input Integrated:    -26.5 LUFS\nOutput Integrated:   -16.0 LUFS\nOutput True Peak:     -1.5 dBTP\n'), -16);
    assert.equal(parseOutputIntegrated('no summary'), undefined);
  });
});
