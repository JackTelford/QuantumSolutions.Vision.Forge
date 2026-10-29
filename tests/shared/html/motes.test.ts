import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maxMotes, moteDepthRangeM, moteField, motePosition, moteStyle } from '../../../src/shared/html/motes.ts';
import { stageGeometry } from '../../../src/shared/html/stage.ts';
import { htmlPageSpec, htmlShot } from './fixtures.ts';

const spec = htmlPageSpec;
const geometry = stageGeometry(spec);

describe('moteField', () => {
  it('places as many motes as the shot asks, capped at 300, and none for none', () => {
    assert.equal(moteField(htmlShot, geometry).length, 200);
    assert.equal(moteField({ ...htmlShot, atmosphere: { haze: 0, motes: 1000 } }, geometry).length, maxMotes);
    assert.equal(moteField({ ...htmlShot, atmosphere: { haze: 0, motes: 0 } }, geometry).length, 0);
  });

  it('is the same field for the same seed and a different one for another seed', () => {
    assert.deepEqual(moteField(htmlShot, geometry), moteField(htmlShot, geometry));
    assert.notDeepEqual(moteField(htmlShot, geometry), moteField({ ...htmlShot, seed: 8 }, geometry));
  });

  it('keeps every mote inside the volume: 1.5 frames wide and high, between -0.4 and +0.3 m deep, 2 to 4 px, 0.15 to 0.4 opaque', () => {
    for (const mote of moteField(htmlShot, geometry)) {
      assert.ok(Math.abs(mote.rest.x) <= 0.75 * geometry.frameWidthM);
      assert.ok(Math.abs(mote.rest.y) <= 0.75 * geometry.frameHeightM);
      assert.ok(mote.rest.z >= moteDepthRangeM.far && mote.rest.z <= moteDepthRangeM.near);
      assert.ok(mote.sizePx >= 2 && mote.sizePx <= 4);
      assert.ok(mote.opacity >= 0.15 && mote.opacity <= 0.4);
      assert.ok(mote.phase >= 0 && mote.phase < 2 * Math.PI);
    }
  });
});

describe('motePosition', () => {
  it('drifts on a slow sine of the shot time, by at most 2 cm, as a pure function of the frame', () => {
    const mote = moteField(htmlShot, geometry)[0] ?? assert.fail('a mote');
    const positions = [0, 15, 30, 90].map((frame) => motePosition(mote, frame, spec.fps));
    assert.ok(positions.every((position) => Math.abs(position.y - mote.rest.y) <= 0.02 + 1e-12 && position.x === mote.rest.x && position.z === mote.rest.z));
    assert.notEqual(positions[0]?.y, positions[30 / 15]?.y, 'the mote moves between frames 0 and 30');
    assert.deepEqual(motePosition(mote, 42, spec.fps), motePosition(mote, 42, spec.fps));
  });

  it('is written as a round dot of the highlight colour at the drifted stage point', () => {
    const mote = moteField(htmlShot, geometry)[3] ?? assert.fail('a mote');
    const style = moteStyle(mote, 10, spec.fps, geometry, spec.look.palette);
    assert.equal(style['border-radius'], '50%');
    assert.equal(style['background'], spec.look.palette.highlight);
    assert.equal(style['opacity'], mote.opacity.toFixed(3));
    assert.match(style['transform'] ?? '', /^translate3d\(-?\d+\.\d{3}px, -?\d+\.\d{3}px, -?\d+\.\d{3}px\)$/);
  });
});
