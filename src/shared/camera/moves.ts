/**
 * The move catalogue: one row per CameraMove, exactly as the table in
 * skills/cinematic-studio/references/cinematography/camera-moves.md. The
 * cap is the travel at amplitude 1 in the unit named; the validator holds
 * every shot inside it and the baker (bake.ts) scales by amplitude.
 */
import type { CameraMove, Lane } from '../contracts/shot-spec.ts';
import type { MoveDefinition } from './types.ts';

const allLanes: readonly Lane[] = ['html', 'three', 'blender'];
const threeDimensionalLanes: readonly Lane[] = ['three', 'blender'];
const browserLanes: readonly Lane[] = ['html', 'three'];

/** The handheld move's second cap: the rotation noise on pitch, yaw and roll at amplitude 1, in degrees. */
export const handheldRotationCapDeg = 0.5;

/** The handheld move's position noise at amplitude 1 as a fraction of the camera distance. */
export const handheldPositionCap = 0.004;

/** The frequency of the handheld value noise in hertz: one fresh sample every two thirds of a second. */
export const handheldNoiseHz = 1.5;

/** The move catalogue of camera-moves.md. */
export const cameraMoves: Readonly<Record<CameraMove, MoveDefinition>> = {
  'static-hold': { cap: 0, unit: 'none', defaultEasing: 'linear', lanes: allLanes, endsAtCut: false, description: 'nothing; the default for reading text' },
  breathe: { cap: 0.005, unit: 'distance-fraction', defaultEasing: 'sine-in-out', lanes: allLanes, endsAtCut: false, description: 'a slow drift toward the subject and back' },
  'push-in': { cap: 0.15, unit: 'distance-fraction', defaultEasing: 'emphasized', lanes: allLanes, endsAtCut: false, description: 'dolly toward the subject' },
  'pull-out': { cap: 0.15, unit: 'distance-fraction', defaultEasing: 'emphasized', lanes: allLanes, endsAtCut: false, description: 'dolly away from the subject' },
  'truck-left': { cap: 0.1, unit: 'subject-width-fraction', defaultEasing: 'sine-in-out', lanes: allLanes, endsAtCut: false, description: 'lateral slide to the left, subject stays framed' },
  'truck-right': { cap: 0.1, unit: 'subject-width-fraction', defaultEasing: 'sine-in-out', lanes: allLanes, endsAtCut: false, description: 'lateral slide to the right, subject stays framed' },
  'pedestal-up': { cap: 0.1, unit: 'subject-height-fraction', defaultEasing: 'sine-in-out', lanes: allLanes, endsAtCut: false, description: 'vertical slide up' },
  'pedestal-down': { cap: 0.1, unit: 'subject-height-fraction', defaultEasing: 'sine-in-out', lanes: allLanes, endsAtCut: false, description: 'vertical slide down' },
  'pan-left': { cap: 10, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'rotate the view left about the vertical axis' },
  'pan-right': { cap: 10, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'rotate the view right about the vertical axis' },
  'tilt-up': { cap: 10, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'rotate the view up about the horizontal axis' },
  'tilt-down': { cap: 10, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'rotate the view down about the horizontal axis' },
  'arc-left': { cap: 60, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'orbit to the left around the subject at constant distance' },
  'arc-right': { cap: 60, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'orbit to the right around the subject at constant distance' },
  turntable: { cap: 40, unit: 'degrees', defaultEasing: 'linear', lanes: threeDimensionalLanes, endsAtCut: false, description: 'the subject rotates, the camera holds' },
  'crane-reveal': { cap: 0.12, unit: 'subject-height-fraction', defaultEasing: 'emphasized-decelerate', lanes: threeDimensionalLanes, endsAtCut: false, description: 'pedestal up while tilting down to keep the subject' },
  'rack-focus': { cap: 1, unit: 'focus-travel-fraction', defaultEasing: 'emphasized', lanes: threeDimensionalLanes, endsAtCut: false, description: 'focus distance travels from one point to another; no movement' },
  'zoom-in': { cap: 1.5, unit: 'focal-multiplier', defaultEasing: 'emphasized', lanes: allLanes, endsAtCut: false, description: 'focal length grows, camera holds' },
  'zoom-out': { cap: 1.5, unit: 'focal-multiplier', defaultEasing: 'emphasized', lanes: allLanes, endsAtCut: false, description: 'focal length shrinks, camera holds' },
  'crash-zoom': { cap: 2, unit: 'focal-multiplier', defaultEasing: 'emphasized-accelerate', lanes: browserLanes, endsAtCut: true, description: 'a fast zoom with a hard stop at the cut' },
  'dolly-zoom': { cap: 1.5, unit: 'focal-multiplier', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'focal length and distance change together so the subject keeps its size' },
  'whip-pan': { cap: 45, unit: 'degrees', defaultEasing: 'emphasized-accelerate', lanes: browserLanes, endsAtCut: true, description: 'a fast pan that blurs into the next shot' },
  handheld: { cap: handheldPositionCap, unit: 'distance-fraction', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'seeded noise on position and rotation' },
  'parallax-drift': { cap: 0.06, unit: 'stage-width-fraction', defaultEasing: 'sine-in-out', lanes: ['html'], endsAtCut: false, description: 'layers slide at depth-dependent speeds' },
  'light-sweep': { cap: 90, unit: 'degrees', defaultEasing: 'sine-in-out', lanes: threeDimensionalLanes, endsAtCut: false, description: 'the camera holds; the key light orbits' },
  'top-down-reveal': { cap: 90, unit: 'degrees', defaultEasing: 'emphasized-decelerate', lanes: threeDimensionalLanes, endsAtCut: false, description: 'tilt down from overhead to the angle of the shot' },
};

/** The lanes that can render the move. */
export function moveLanes(move: CameraMove): readonly Lane[] {
  return cameraMoves[move].lanes;
}

/** True when the move accelerates into the cut instead of settling (whip-pan, crash-zoom). */
export function moveEndsAtCut(move: CameraMove): boolean {
  return cameraMoves[move].endsAtCut;
}
