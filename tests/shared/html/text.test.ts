import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TextElement } from '../../../src/shared/contracts/shot-spec.ts';
import { textAlign, textBoxStyle, textElementVisible, textPlate, textPlateStyle, textSpanContent, textSpanStates, textSpanStyle, textSpans, fittedFontSizePx } from '../../../src/shared/html/text.ts';
import { hiddenState, shownState, textTiming } from '../../../src/shared/typography/text-animation.ts';
import { htmlPageSpec, htmlShot } from './fixtures.ts';

const spec = htmlPageSpec;
const look = spec.look;
const title: TextElement = htmlShot.text[0] ?? assert.fail('the title');

describe('text plates and spans', () => {
  it('put lower thirds on a plate, captions on a scrim and the rest on nothing', () => {
    assert.equal(textPlate('lower-third-name'), 'lower-third');
    assert.equal(textPlate('lower-third-title'), 'lower-third');
    assert.equal(textPlate('caption'), 'caption');
    assert.equal(textPlate('title'), 'none');
    assert.equal(textPlate('counter'), 'none');
  });

  it('split stagger-words into one span per word and keep everything else whole', () => {
    assert.deepEqual(textSpans({ ...title, animation: 'stagger-words' }), ['Now', 'in', '500', 'ml']);
    assert.deepEqual(textSpans(title), ['Now in 500 ml']);
    assert.deepEqual(textSpans({ ...title, content: '' }), []);
  });

  it('align with the text side: left, right, else centre', () => {
    assert.equal(textAlign(htmlShot), 'left');
    assert.equal(textAlign({ ...htmlShot, composition: { ...htmlShot.composition, textSide: 'right' } }), 'right');
    assert.equal(textAlign({ ...htmlShot, composition: { ...htmlShot.composition, textSide: 'none' } }), 'center');
  });
});

describe('textBoxStyle', () => {
  it('places the box from its frame fractions and sets the role type from the look', () => {
    const style = textBoxStyle(title, spec, look);
    assert.equal(style['left'], '192.000px');
    assert.equal(style['top'], '756.000px');
    assert.equal(style['width'], '768.000px');
    assert.equal(style['height'], '129.600px');
    assert.equal(style['font-family'], "'Playfair Display'");
    // The 140 px scale size wraps "Now in 500 ml" to two lines in a 768 x 129.6 px box, so the fit shrinks it to one line (typography/fit.ts).
    assert.equal(style['font-size'], `${fittedFontSizePx(title, spec, look).toFixed(3)}px`);
    assert.ok(fittedFontSizePx(title, spec, look) < 140 && fittedFontSizePx(title, spec, look) >= 72);
    assert.equal(style['font-weight'], '700');
    assert.equal(style['line-height'], '1.100');
    assert.equal(style['color'], look.palette.text);
    assert.equal(style['text-align'], 'left');
    assert.equal(style['justify-content'], 'flex-start');
    assert.equal(style['align-items'], 'center');
    assert.equal(style['text-wrap'], 'balance');
    assert.equal(style['text-transform'], undefined);
    assert.equal(style['font-variant-numeric'], undefined);
  });

  it('bottom-aligns lower thirds, capitalises lower-third titles and gives counters tabular figures', () => {
    const lowerThird = textBoxStyle({ ...title, role: 'lower-third-title' }, spec, look);
    assert.equal(lowerThird['align-items'], 'flex-end');
    assert.equal(lowerThird['text-transform'], 'uppercase');
    assert.equal(lowerThird['font-family'], "'Inter'");
    assert.equal(textBoxStyle({ ...title, role: 'counter' }, spec, look)['font-variant-numeric'], 'tabular-nums');
  });

  it('scales with the frame height', () => {
    const small = textBoxStyle(title, { ...spec, width: 480, height: 270 }, look);
    assert.equal(small['font-size'], `${fittedFontSizePx(title, { ...spec, width: 480, height: 270 }, look).toFixed(3)}px`);
    assert.ok(fittedFontSizePx(title, { ...spec, width: 480, height: 270 }, look) <= 35);
    assert.equal(small['left'], '48.000px');
  });
});

describe('textPlateStyle', () => {
  it('gives a lower third a surface plate with 24 px padding and a 6 px accent bar at 1080p, scaled at 4K', () => {
    const plate = textPlateStyle('lower-third', look.palette, 1080);
    assert.equal(plate['background'], look.palette.surface);
    assert.equal(plate['padding'], '24.000px');
    assert.equal(plate['border-left'], `6.000px solid ${look.palette.accent}`);
    assert.equal(textPlateStyle('lower-third', look.palette, 2160)['padding'], '48.000px');
  });

  it('gives a caption a 60 percent background scrim and a title nothing', () => {
    assert.equal(textPlateStyle('caption', look.palette, 1080)['background'], 'rgba(11, 11, 15, 0.60)');
    assert.equal(textPlateStyle('none', look.palette, 1080)['background'], undefined);
  });
});

describe('the span state per frame', () => {
  it('is hidden before inFrame, entering during the entrance, shown on the hold and hidden again from outFrame', () => {
    const timing = textTiming(title, spec.fps);
    assert.equal(textSpanStates(title, 0, spec)[0]?.phase, 'before');
    assert.equal(textSpanStates(title, timing.enterStart + 2, spec)[0]?.phase, 'entering');
    assert.equal(textSpanStates(title, 60, spec)[0]?.phase, 'hold');
    assert.equal(textSpanStates(title, 119, spec)[0]?.phase, 'after');
    assert.equal(textElementVisible(textSpanStates(title, 0, spec)), false);
    assert.equal(textElementVisible(textSpanStates(title, 60, spec)), true);
    assert.equal(textElementVisible(textSpanStates(title, 119, spec)), false);
  });

  it('staggers the words: the last word is still hidden when the first has begun', () => {
    const staggered: TextElement = { ...title, animation: 'stagger-words', staggerMs: 80 };
    const states = textSpanStates(staggered, staggered.inFrame + 1, spec);
    assert.equal(states.length, 4);
    assert.equal(states[0]?.phase, 'entering');
    assert.equal(states[3]?.phase, 'before');
    assert.equal(textElementVisible(states), true);
  });
});

describe('textSpanStyle', () => {
  it('writes opacity, rise and tracking, hides a hidden span, and omits the blur and the clip when they are idle', () => {
    const shown = textSpanStyle(shownState, title, look);
    assert.deepEqual(shown, { display: 'inline-block', opacity: '1.000', transform: 'translateY(0.000px)', 'letter-spacing': '-0.020em' });
    const hidden = textSpanStyle(hiddenState, title, look);
    assert.equal(hidden['display'], 'none');
    const rising = textSpanStyle({ ...shownState, phase: 'entering', opacity: 0.5, translateYPx: 12 }, title, look);
    assert.equal(rising['opacity'], '0.500');
    assert.equal(rising['transform'], 'translateY(12.000px)');
    assert.equal(rising['display'], 'inline-block');
  });

  it('adds the blur, the extra tracking and the mask-wipe clip when the animation asks', () => {
    const blurred = textSpanStyle({ ...shownState, blurPx: 4 }, title, look);
    assert.equal(blurred['filter'], 'blur(4.000px)');
    const tracked = textSpanStyle({ ...shownState, trackingEmExtra: 0.3 }, title, look);
    assert.equal(tracked['letter-spacing'], '0.280em');
    const wiped = textSpanStyle({ ...shownState, revealFraction: 0.25 }, title, look);
    assert.equal(wiped['clip-path'], 'inset(0 75.000% 0 0)');
  });

  it('keeps an exiting span visible at opacity 0 only while it is still exiting', () => {
    const exiting = textSpanStyle({ ...shownState, phase: 'exiting', opacity: 0 }, title, look);
    assert.equal(exiting['display'], 'inline-block');
  });
});

describe('textSpanContent', () => {
  it('counts a counter up to its value and leaves other roles alone', () => {
    const counter: TextElement = { ...title, role: 'counter', content: '1,200 km', animation: 'counter' };
    assert.equal(textSpanContent(counter, counter.content, { ...shownState, counterFraction: 0.5 }), '600 km');
    assert.equal(textSpanContent(counter, counter.content, shownState), '1,200 km');
    assert.equal(textSpanContent(title, 'Now in 500 ml', { ...shownState, counterFraction: 0.5 }), 'Now in 500 ml');
  });
});
