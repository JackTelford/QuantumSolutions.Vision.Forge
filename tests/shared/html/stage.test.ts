import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cssProjectedPoint, stagePxPerMetre, worldPointToStage } from '../../../src/shared/camera/css-transform.ts';
import { project } from '../../../src/shared/camera/project.ts';
import type { CameraFrame } from '../../../src/shared/camera/types.ts';
import { backdropDepthM, backdropGradientWindow, backdropStyle, hazeDepthM, hazeStyle, plateGrowth, plateSizePx, shadowDropM, shadowStyle, stageGeometry, stageStyle, viewportStyle } from '../../../src/shared/html/stage.ts';
import { centredBox, px, styleText } from '../../../src/shared/html/styles.ts';
import { shotLightingRig } from '../../../src/shared/lighting/rigs.ts';
import { lightingGradient, lightingGradientWithin } from '../../../src/shared/look/css-tokens.ts';
import { htmlPageSpec, htmlShot, pageSpecFor } from './fixtures.ts';

const spec = htmlPageSpec;
const geometry = stageGeometry(spec);
const rig = shotLightingRig(spec.shot.lighting);
const palette = spec.look.palette;

function frameAt(k: number): CameraFrame {
  const frame = spec.camera[k];
  assert.ok(frame !== undefined, `frame ${k}`);
  return frame;
}

describe('style helpers', () => {
  it('write pixels and numbers with three decimals and join a map as cssText', () => {
    assert.equal(px(1.23456), '1.235px');
    assert.equal(styleText({ left: '1px', 'z-index': '2' }), 'left: 1px; z-index: 2');
    assert.deepEqual(centredBox(100, 50), { position: 'absolute', left: '-50.000px', top: '-25.000px', width: '100.000px', height: '50.000px' });
  });
});

describe('stageGeometry', () => {
  it('takes the pixel scale from the base pose and measures the frame in metres on the subject plane', () => {
    assert.equal(geometry.pxPerMetre, stagePxPerMetre(spec, htmlShot.lens.focalMm, spec.baseDistanceM));
    assert.ok(Math.abs(geometry.frameWidthM * geometry.pxPerMetre - 1920) < 1e-9);
    assert.ok(Math.abs(geometry.frameHeightM * geometry.pxPerMetre - 1080) < 1e-9);
    assert.equal(geometry.scale, 1);
  });

  it('sizes a plate to four frames as measured at its depth, so the backdrop outgrows the haze', () => {
    const backdrop = plateSizePx(spec, backdropDepthM);
    const haze = plateSizePx(spec, hazeDepthM);
    assert.ok(backdrop.widthPx > haze.widthPx && haze.widthPx > 4 * 1920);
    assert.ok(Math.abs(backdrop.widthPx / backdrop.heightPx - 16 / 9) < 1e-9);
    assert.ok(Math.abs(plateSizePx(spec, 0).widthPx - 4 * 1920) < 1e-9, 'a plate on the subject plane is exactly four frame widths');
  });
});

describe('the viewport and the stage', () => {
  it('carry the frame perspective, the lit gradient and a preserve-3d matrix at the centre', () => {
    const viewport = viewportStyle(spec, frameAt(0), geometry, rig, palette);
    assert.equal(viewport['perspective-origin'], '50% 50%');
    assert.match(viewport['perspective'] ?? '', /^\d+\.\d{3}px$/);
    assert.match(viewport['background'] ?? '', /^linear-gradient\(/);
    const stage = stageStyle(spec, frameAt(0), geometry);
    assert.equal(stage['transform-style'], 'preserve-3d');
    assert.equal(stage['transform-origin'], '0 0 0');
    assert.match(stage['transform'] ?? '', /^translate\(0\.000px, 0\.000px\) matrix3d\(/);
  });

  it('slides the stage by the parallax-drift offset in pixels before the matrix', () => {
    const drift = pageSpecFor({ ...htmlShot, move: { preset: 'parallax-drift', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: null } });
    const last = drift.camera[drift.camera.length - 1];
    assert.ok(last !== undefined && last.stageOffset.x > 0);
    const style = stageStyle(drift, last, stageGeometry(drift));
    assert.match(style['transform'] ?? '', new RegExp(`^translate\\(${px(last.stageOffset.x * 1920).replace('.', '\\.')}, 0\\.000px\\) matrix3d`));
  });

  it('puts the anchor where the pinhole projection puts it: thirds-right at x 0.667 for this shot', () => {
    const frame = frameAt(0);
    const projected = project({ x: 0, y: 0, z: 0 }, frame, 16 / 9);
    assert.ok(projected !== null);
    assert.ok(Math.abs(projected.x - 0.667) < 0.01, `anchor x ${projected.x}`);
    const css = cssProjectedPoint(worldPointToStage({ x: 0, y: 0, z: 0 }, geometry.pxPerMetre), frame, spec, geometry.pxPerMetre);
    assert.ok(css !== null);
    assert.ok(Math.abs(css.x / 1920 + 0.5 - projected.x) < 1e-6, 'CSS and pinhole agree');
  });
});

describe('the plates', () => {
  it('hang the backdrop and the haze at their depths, centred, with the gradient and the hazed background', () => {
    const backdrop = backdropStyle(spec, geometry, frameAt(0), rig, palette);
    assert.equal(backdrop['transform'], `translate3d(0.000px, 0.000px, ${px(backdropDepthM * geometry.pxPerMetre)})`);
    assert.equal(backdrop['background'], lightingGradientWithin(rig, palette, 0, 37.5, 25));
    assert.equal(viewportStyle(spec, frameAt(0), geometry, rig, palette)['background'], lightingGradient(rig, palette, 0));
    const haze = hazeStyle(spec, geometry, palette);
    assert.equal(haze['transform'], `translate3d(0.000px, 0.000px, ${px(hazeDepthM * geometry.pxPerMetre)})`);
    assert.equal(haze['background'], 'rgba(11, 11, 15, 0.09)');
  });

  it('confines the backdrop fade to the quarter of the plate the frame sees at the base pose, so the lit side is in the frame', () => {
    const backdrop = backdropStyle(spec, geometry, frameAt(0), rig, palette);
    const growth = plateGrowth(spec, backdropDepthM);
    assert.ok(growth > 1, 'a plate behind the subject shows more than the subject plane');
    assert.ok(Math.abs(plateSizePx(spec, backdropDepthM).widthPx / (1920 * growth) - 4) < 1e-9, 'the plate is four frames wide as measured at its depth');
    assert.deepEqual(backdropGradientWindow, { startPercent: 37.5, spanPercent: 25 });
    // The fixture's 4:1 ratio fades to the background at 67.86 percent of the frame slice: 37.5 + 25 * 0.6786 = 54.46.
    assert.match(backdrop['background'] ?? '', /^linear-gradient\(225\.00deg, #16161d 37\.50%, #0b0b0f 54\.46%\)$/);
  });

  it('turns the backdrop gradient with the key-light orbit', () => {
    const sweep = pageSpecFor({ ...htmlShot, move: { preset: 'light-sweep', amplitude: 1, easing: 'linear', startFrame: 0, endFrame: null } });
    const last = sweep.camera[sweep.camera.length - 1] ?? assert.fail('last frame');
    assert.notEqual(backdropStyle(sweep, stageGeometry(sweep), last, rig, palette)['background'], backdropStyle(sweep, stageGeometry(sweep), frameAt(0), rig, palette)['background']);
  });

  it('puts a soft camera-facing shadow ellipse just below the subject base, wider than the subject, fading to clear', () => {
    const shadow = shadowStyle(spec, geometry, palette);
    const u = geometry.pxPerMetre;
    const bounds = htmlShot.subject.boundsM;
    assert.equal(shadow['transform'], `translate3d(0.000px, ${px((bounds.h / 2 + shadowDropM) * u)}, 0.000px)`);
    assert.equal(shadow['width'], px(bounds.w * 2.2 * u));
    assert.equal(shadow['height'], px(bounds.d * 0.6 * u));
    assert.equal(shadow['background'], 'radial-gradient(ellipse at center, rgba(11, 11, 15, 0.35) 0%, rgba(11, 11, 15, 0.00) 70.000%)');
    assert.equal(shadow['filter'], undefined, 'no blur filter: the gradient is soft on its own');
  });
});
