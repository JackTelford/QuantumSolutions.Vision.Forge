import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bokehMaxBlur, bokehParameters, circleOfConfusionFraction } from '../../../src/shared/camera/bokeh.ts';
import { thinLens } from '../../../src/shared/camera/model.ts';

const aspect = 16 / 9;

describe('bokeh parameters', () => {
  it('is zero blur at the focus plane and grows with defocus, halving when the f-number doubles', () => {
    assert.equal(circleOfConfusionFraction(85, 2.8, 1.2, 1.2, aspect), 0);
    const near = circleOfConfusionFraction(85, 2.8, 1.2, 1.1, aspect);
    const far = circleOfConfusionFraction(85, 2.8, 1.2, 2.4, aspect);
    assert.ok(near > 0 && far > near);
    assert.ok(Math.abs(circleOfConfusionFraction(85, 5.6, 1.2, 2.4, aspect) - far / 2) < 1e-12);
  });

  it('matches the thin-lens depth of field: at the far limit the circle equals the model\'s 0.03 mm', () => {
    const lens = thinLens(85, 4, 1.2);
    const fraction = circleOfConfusionFraction(85, 4, 1.2, lens.farM, aspect);
    assert.ok(Math.abs(fraction * (36 / aspect) - 0.03) < 1e-4, `circle ${fraction * (36 / aspect)} mm at the far limit`);
  });

  it('gives BokehPass half the circle per metre of defocus at the focus plane, the focus distance and the cap', () => {
    const parameters = bokehParameters(85, 2.8, 1.2, aspect);
    assert.equal(parameters.focusM, 1.2);
    assert.equal(parameters.maxBlur, bokehMaxBlur);
    const perMetre = circleOfConfusionFraction(85, 2.8, 1.2, 1.2 + 0.001, aspect) / 0.001;
    assert.ok(Math.abs(parameters.aperture - perMetre / 2) / parameters.aperture < 1e-3);
    assert.ok(bokehParameters(85, 2.8, 0.05, aspect).aperture === 0, 'a focus distance at or inside the focal length has no defocus model');
  });
});
