import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraMoves, handheldNoiseHz, handheldPositionCap, handheldRotationCapDeg, moveEndsAtCut, moveLanes } from '../../../src/shared/camera/moves.ts';
import type { MoveDefinition } from '../../../src/shared/camera/types.ts';
import { CameraMoveValues, EasingTokenValues, LaneValues } from '../../../src/shared/contracts/shot-spec.ts';
import type { CameraMove } from '../../../src/shared/contracts/shot-spec.ts';

/** The cap, unit, default easing and lanes columns of camera-moves.md, row by row. */
const table: Readonly<Record<CameraMove, Pick<MoveDefinition, 'cap' | 'unit' | 'defaultEasing' | 'lanes'>>> = {
  'static-hold': { cap: 0, unit: 'none', defaultEasing: 'linear', lanes: ['html', 'three', 'blender'] },
  breathe: { cap: 0.005, unit: 'distance-fraction', defaultEasing: 'sine-in-out', lanes: ['html', 'three', 'blender'] },
  'push-in': { cap: 0.15, unit: 'distance-fraction', defaultEasing: 'emphasized', lanes: ['html', 'three', 'blender'] },
  'pull-out': { cap: 0.15, unit: 'distance-fraction', defaultEasing: 'emphasized', lanes: ['html', 'three', 'blender'] },
  'truck-left': { cap: 0.1, unit: 'subject-width-fraction', defaultEasing: 'sine-in-out', lanes: ['html', 'three', 'blender'] },
  'truck-right': { cap: 0.1, unit: 'subject-width-fraction', defaultEasing: 'sine-in-out', lanes: ['html', 'three', 'blender'] },
  'pedestal-up': { cap: 0.1, unit: 'subject-height-fraction', defaultEasing: 'sine-in-out', lanes: ['html', 'three', 'blender'] },
  'pedestal-down': { cap: 0.1, unit: 'subject-height-fraction', defaultEasing: 'sine-in-out', lanes: ['html', 'three', 'blender'] },
  'pan-left': { cap: 10, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  'pan-right': { cap: 10, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  'tilt-up': { cap: 10, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  'tilt-down': { cap: 10, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  'arc-left': { cap: 60, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  'arc-right': { cap: 60, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  turntable: { cap: 40, unit: 'degrees', defaultEasing: 'linear', lanes: ['three', 'blender'] },
  'crane-reveal': { cap: 0.12, unit: 'subject-height-fraction', defaultEasing: 'emphasized-decelerate', lanes: ['three', 'blender'] },
  'rack-focus': { cap: 1, unit: 'focus-travel-fraction', defaultEasing: 'emphasized', lanes: ['three', 'blender'] },
  'zoom-in': { cap: 1.5, unit: 'focal-multiplier', defaultEasing: 'emphasized', lanes: ['html', 'three', 'blender'] },
  'zoom-out': { cap: 1.5, unit: 'focal-multiplier', defaultEasing: 'emphasized', lanes: ['html', 'three', 'blender'] },
  'crash-zoom': { cap: 2, unit: 'focal-multiplier', defaultEasing: 'emphasized-accelerate', lanes: ['html', 'three'] },
  'dolly-zoom': { cap: 1.5, unit: 'focal-multiplier', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  'whip-pan': { cap: 45, unit: 'degrees', defaultEasing: 'emphasized-accelerate', lanes: ['html', 'three'] },
  handheld: { cap: 0.004, unit: 'distance-fraction', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  'parallax-drift': { cap: 0.06, unit: 'stage-width-fraction', defaultEasing: 'sine-in-out', lanes: ['html'] },
  'light-sweep': { cap: 90, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: ['three', 'blender'] },
  'top-down-reveal': { cap: 90, unit: 'degrees', defaultEasing: 'emphasized-decelerate', lanes: ['three', 'blender'] },
};

describe('cameraMoves', () => {
  it('has one definition for every CameraMove of the contract and nothing else', () => {
    assert.deepEqual(Object.keys(cameraMoves).sort(), [...CameraMoveValues].sort());
  });

  it('matches the cap, unit, default easing and lanes of every row of camera-moves.md', () => {
    for (const move of CameraMoveValues) {
      const definition = cameraMoves[move];
      const expected = table[move];
      assert.equal(definition.cap, expected.cap, `${move} cap`);
      assert.equal(definition.unit, expected.unit, `${move} unit`);
      assert.equal(definition.defaultEasing, expected.defaultEasing, `${move} easing`);
      assert.deepEqual([...definition.lanes], expected.lanes, `${move} lanes`);
      assert.ok(definition.description.length > 0, `${move} description`);
    }
  });

  it('marks exactly whip-pan and crash-zoom as ending at the cut', () => {
    const atCut = CameraMoveValues.filter((move) => cameraMoves[move].endsAtCut);
    assert.deepEqual(atCut, ['crash-zoom', 'whip-pan']);
    assert.equal(moveEndsAtCut('whip-pan'), true);
    assert.equal(moveEndsAtCut('push-in'), false);
  });

  it('uses only lanes and easing tokens the contract knows', () => {
    for (const move of CameraMoveValues) {
      assert.ok(EasingTokenValues.includes(cameraMoves[move].defaultEasing), `${move} easing token`);
      for (const lane of cameraMoves[move].lanes) assert.ok(LaneValues.includes(lane), `${move} lane ${lane}`);
      assert.deepEqual(moveLanes(move), cameraMoves[move].lanes);
    }
  });

  it('keeps the handheld caps of the table: 0.4 percent of the distance, 0.5 degrees, at about 1.5 Hz', () => {
    assert.equal(handheldPositionCap, 0.004);
    assert.equal(handheldRotationCapDeg, 0.5);
    assert.equal(handheldNoiseHz, 1.5);
  });
});
