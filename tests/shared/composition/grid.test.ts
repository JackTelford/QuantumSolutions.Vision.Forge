import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  anchorToleranceFraction,
  boxesOverlap,
  gridPoint,
  insideBox,
  safeAreas,
} from '../../../src/shared/composition/grid.ts';
import { CompositionAnchorValues } from '../../../src/shared/contracts/shot-spec.ts';

describe('gridPoint', () => {
  it('names the point of every anchor in composition/rules.md', () => {
    assert.deepEqual(gridPoint('center'), { x: 0.5, y: 0.5 });
    assert.deepEqual(gridPoint('thirds-left'), { x: 0.333, y: 0.5 });
    assert.deepEqual(gridPoint('thirds-right'), { x: 0.667, y: 0.5 });
    assert.deepEqual(gridPoint('thirds-top'), { x: 0.5, y: 0.333 });
    assert.deepEqual(gridPoint('thirds-bottom'), { x: 0.5, y: 0.667 });
    assert.deepEqual(gridPoint('golden-left'), { x: 0.382, y: 0.5 });
    assert.deepEqual(gridPoint('golden-right'), { x: 0.618, y: 0.5 });
    for (const anchor of CompositionAnchorValues) assert.ok(gridPoint(anchor) !== undefined, anchor);
  });

  it('tolerates 4 percent of the frame width', () => {
    assert.equal(anchorToleranceFraction, 0.04);
  });
});

describe('safeAreas', () => {
  it('are the central 93 and 90 percent, with title safe inside action safe', () => {
    assert.deepEqual(safeAreas.action, { x: 0.035, y: 0.035, w: 0.93, h: 0.93 });
    assert.deepEqual(safeAreas.title, { x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    assert.equal(insideBox(safeAreas.title, safeAreas.action), true);
    assert.equal(insideBox(safeAreas.action, safeAreas.title), false);
  });
});

describe('insideBox', () => {
  it('accepts a box on the outer edges and rejects one that crosses any edge', () => {
    const outer = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    assert.equal(insideBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, outer), true);
    assert.equal(insideBox({ x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, outer), true);
    assert.equal(insideBox({ x: 0.05, y: 0.2, w: 0.1, h: 0.1 }, outer), false);
    assert.equal(insideBox({ x: 0.85, y: 0.2, w: 0.1, h: 0.1 }, outer), false);
    assert.equal(insideBox({ x: 0.2, y: 0.05, w: 0.1, h: 0.1 }, outer), false);
    assert.equal(insideBox({ x: 0.2, y: 0.85, w: 0.1, h: 0.1 }, outer), false);
  });
});

describe('boxesOverlap', () => {
  it('is true for boxes that share area and false for boxes that only touch or are apart', () => {
    const a = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    assert.equal(boxesOverlap(a, { x: 0.3, y: 0.3, w: 0.3, h: 0.3 }), true);
    assert.equal(boxesOverlap({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, a), true);
    assert.equal(boxesOverlap(a, { x: 0.4, y: 0.1, w: 0.3, h: 0.3 }), false);
    assert.equal(boxesOverlap(a, { x: 0.1, y: 0.4, w: 0.3, h: 0.3 }), false);
    assert.equal(boxesOverlap(a, { x: 0.6, y: 0.6, w: 0.1, h: 0.1 }), false);
    assert.equal(boxesOverlap(a, { x: 0.15, y: 0.15, w: 0.1, h: 0.1 }), true);
  });
});
