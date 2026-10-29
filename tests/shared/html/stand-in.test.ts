import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PrimitiveValues } from '../../../src/shared/contracts/shot-spec.ts';
import type { Primitive } from '../../../src/shared/contracts/shot-spec.ts';
import { stageGeometry } from '../../../src/shared/html/stage.ts';
import { standInContainerStyle, standInPartNames, standInParts } from '../../../src/shared/html/stand-in.ts';
import { px } from '../../../src/shared/html/styles.ts';
import { shotLightingRig } from '../../../src/shared/lighting/rigs.ts';
import { htmlPageSpec, htmlShot, pageSpecFor } from './fixtures.ts';

const spec = htmlPageSpec;
const geometry = stageGeometry(spec);
const rig = shotLightingRig(htmlShot.lighting);
const palette = spec.look.palette;

describe('the stand-in container', () => {
  it('is the subject bounds in stage pixels, centred on the anchor', () => {
    const style = standInContainerStyle(htmlShot, geometry, spec.camera[0] ?? assert.fail('frame 0'));
    const u = geometry.pxPerMetre;
    assert.equal(style['width'], px(0.08 * u));
    assert.equal(style['height'], px(0.25 * u));
    assert.equal(style['left'], px(-0.04 * u));
    assert.equal(style['transform'], 'translate3d(0.000px, 0.000px, 0.000px)');
    // The solver frames an MCU so the subject takes 0.625 of the frame height (675 px of 1080, as measured in Edge).
    assert.ok(Math.abs((0.25 * u) / 1080 - 0.625) < 0.01, `MCU subject height fraction ${(0.25 * u) / 1080}`);
  });

  it('turns about its vertical axis by the turntable angle', () => {
    const turntable = pageSpecFor({ ...htmlShot, move: { preset: 'turntable', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: null } });
    const frame = turntable.camera[60] ?? assert.fail('frame 60');
    assert.ok(frame.subjectRotationDeg > 0);
    assert.equal(standInContainerStyle(htmlShot, stageGeometry(turntable), frame)['transform'], `translate3d(0.000px, 0.000px, 0.000px) rotateY(${frame.subjectRotationDeg.toFixed(3)}deg)`);
  });
});

describe('the stand-in parts', () => {
  it('name the parts of every primitive and give none for none', () => {
    assert.deepEqual(standInPartNames('bottle'), ['neck', 'body']);
    assert.deepEqual(standInPartNames('jar'), ['body', 'lid']);
    assert.deepEqual(standInPartNames('none'), []);
    for (const primitive of PrimitiveValues) {
      const parts = standInParts({ ...htmlShot, subject: { ...htmlShot.subject, primitive } }, geometry, rig, palette, 0);
      assert.deepEqual(parts.map((part) => part.name), standInPartNames(primitive), primitive);
    }
  });

  it('fill every part with the sheen over the primary colour and a shadow away from the key', () => {
    const [neck, body] = standInParts(htmlShot, geometry, rig, palette, 0);
    assert.ok(body !== undefined && neck !== undefined);
    assert.match(body.style['background'] ?? '', new RegExp(`^linear-gradient\\(.*\\), ${palette.primary}$`));
    assert.match(body.style['box-shadow'] ?? '', /^-\d+\.\d{3}px \d+\.\d{3}px \d+\.\d{3}px rgba\(0, 0, 0, 0\.45\)$/);
    assert.equal(neck.style['top'], '0.000%');
    assert.equal(body.style['top'], '22.000%');
  });

  it('shape the primitives: a 12 percent radius on a can, 4 percent on a card, a full radius on a pill, a circle for a sphere, a hole in a torus', () => {
    const part = (primitive: Primitive): Readonly<Record<string, string>> => standInParts({ ...htmlShot, subject: { ...htmlShot.subject, primitive } }, geometry, rig, palette, 0)[0]?.style ?? assert.fail(primitive);
    const u = geometry.pxPerMetre;
    assert.equal(part('can')['border-radius'], `${px(0.08 * u * 0.12)} / ${px(0.25 * u * 0.12)}`);
    assert.equal(part('card')['border-radius'], px(0.08 * u * 0.04));
    assert.equal(part('pill')['border-radius'], px((0.08 * u) / 2));
    assert.equal(part('sphere')['border-radius'], '50%');
    assert.equal(part('box')['border-radius'], undefined);
    assert.match(part('torus')['mask-image'] ?? '', /radial-gradient/);
  });

  it('turn the sheen with the key-light orbit', () => {
    const still = standInParts(htmlShot, geometry, rig, palette, 0)[0]?.style['background'];
    const swept = standInParts(htmlShot, geometry, rig, palette, 40)[0]?.style['background'];
    assert.notEqual(still, swept);
  });
});
