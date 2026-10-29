import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  headroomGovernsSize,
  headroomRange,
  leadRoomRange,
  shotSizeRanges,
  targetFraction,
} from '../../../src/shared/composition/sizes.ts';
import { ShotSizeValues } from '../../../src/shared/contracts/shot-spec.ts';
import { assertClose } from './fixtures.ts';

const epsilon = 1e-12;

describe('shotSizeRanges', () => {
  it('names a range for every size, each one ending where the next larger size starts', () => {
    for (const size of ShotSizeValues) assert.ok(shotSizeRanges[size].min < shotSizeRanges[size].max, size);
    assert.equal(shotSizeRanges.CU.min, shotSizeRanges.MCU.max);
    assert.equal(shotSizeRanges.MCU.min, shotSizeRanges.MS.max);
    assert.equal(shotSizeRanges.MS.min, shotSizeRanges.MLS.max);
    assert.equal(shotSizeRanges.MLS.min, shotSizeRanges.FS.max);
    assert.equal(shotSizeRanges.FS.min, shotSizeRanges.LS.max);
    assert.equal(shotSizeRanges.LS.min, shotSizeRanges.ELS.max);
  });

  it('puts the ECU above the frame height because the frame sits inside the subject', () => {
    assert.ok(shotSizeRanges.ECU.min > 1);
  });
});

describe('targetFraction', () => {
  it('aims at the middle of the range: 0.475 for an MS, 0.8 for a CU and 2.0 for an ECU', () => {
    assertClose(targetFraction('MS'), 0.475, epsilon, 'MS');
    assertClose(targetFraction('CU'), 0.8, epsilon, 'CU');
    assertClose(targetFraction('ECU'), 2, epsilon, 'ECU');
  });
});

describe('headroomRange', () => {
  it('gives MS, MCU and CU 8 to 12 percent, ECU none, and leaves MLS and wider to the anchor', () => {
    for (const size of ['MS', 'MCU', 'CU'] as const) {
      assert.deepEqual(headroomRange(size), { min: 0.08, max: 0.12 });
      assert.equal(headroomGovernsSize(size), true);
    }
    assert.deepEqual(headroomRange('ECU'), { min: 0, max: 0 });
    assert.equal(headroomGovernsSize('ECU'), false);
    for (const size of ['MLS', 'FS', 'LS', 'ELS'] as const) {
      assert.equal(headroomRange(size), null);
      assert.equal(headroomGovernsSize(size), false);
    }
  });
});

describe('leadRoomRange', () => {
  it('is 15 to 30 percent of the frame width', () => {
    assert.deepEqual(leadRoomRange, { min: 0.15, max: 0.3 });
  });
});
