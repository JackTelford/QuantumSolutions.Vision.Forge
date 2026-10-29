import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { moteDepthRangeM, moteVolumeFrameMultiple } from '../../../src/shared/html/motes.ts';
import { frameSizeAtAnchorM, maxThreeMotes, threeMoteField, threeMotePosition, threeMotePositions } from '../../../src/shared/three/motes.ts';
import { assertClose, pushInShot, pushInSpec } from './fixtures.ts';

const aspect = pushInSpec.width / pushInSpec.height;
const field = threeMoteField(pushInShot, pushInSpec.baseDistanceM, aspect);

describe('threeMoteField', () => {
  it('places as many motes as the shot asks, capped at 400, and none for none', () => {
    assert.equal(field.length, 200);
    assert.equal(threeMoteField({ ...pushInShot, atmosphere: { haze: 0, motes: 1000 } }, pushInSpec.baseDistanceM, aspect).length, maxThreeMotes);
    assert.equal(threeMoteField({ ...pushInShot, atmosphere: { haze: 0, motes: 0 } }, pushInSpec.baseDistanceM, aspect).length, 0);
  });

  it('is the same field for the same seed and a different one for another seed', () => {
    assert.deepEqual(threeMoteField(pushInShot, pushInSpec.baseDistanceM, aspect), field);
    assert.notDeepEqual(threeMoteField({ ...pushInShot, seed: pushInShot.seed + 1 }, pushInSpec.baseDistanceM, aspect), field);
  });

  it('keeps every mote inside 1.5 frames at the anchor and between -0.4 and +0.3 m deep', () => {
    const frame = frameSizeAtAnchorM(pushInShot.lens.focalMm, pushInSpec.baseDistanceM, aspect);
    assertClose(frame.widthM / frame.heightM, aspect, 1e-9, 'frame aspect');
    for (const mote of field) {
      assert.ok(Math.abs(mote.rest.x) <= (moteVolumeFrameMultiple * frame.widthM) / 2);
      assert.ok(Math.abs(mote.rest.y) <= (moteVolumeFrameMultiple * frame.heightM) / 2);
      assert.ok(mote.rest.z >= moteDepthRangeM.far && mote.rest.z <= moteDepthRangeM.near);
      assert.ok(mote.phase >= 0 && mote.phase < 2 * Math.PI);
    }
  });
});

describe('threeMotePosition', () => {
  it('drifts a mote vertically by at most 2 cm as a pure function of the frame, fractional frames included', () => {
    const mote = field[0] ?? assert.fail('a mote');
    for (const frame of [0, 15.25, 30, 89.5]) {
      const position = threeMotePosition(mote, frame, pushInSpec.fps);
      assert.ok(Math.abs(position.y - mote.rest.y) <= 0.02 + 1e-12);
      assert.equal(position.x, mote.rest.x);
      assert.equal(position.z, mote.rest.z);
    }
    assert.notEqual(threeMotePosition(mote, 0, pushInSpec.fps).y, threeMotePosition(mote, 30, pushInSpec.fps).y);
    assert.deepEqual(threeMotePosition(mote, 42, pushInSpec.fps), threeMotePosition(mote, 42, pushInSpec.fps));
  });

  it('lists every position as x, y, z triples in mote order', () => {
    const flat = threeMotePositions(field, 12, pushInSpec.fps);
    assert.equal(flat.length, field.length * 3);
    const third = threeMotePosition(field[2] ?? assert.fail('a mote'), 12, pushInSpec.fps);
    assert.deepEqual(flat.slice(6, 9), [third.x, third.y, third.z]);
  });
});
