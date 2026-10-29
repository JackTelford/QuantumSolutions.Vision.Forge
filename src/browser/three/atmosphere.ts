/**
 * The air of the shot: exponential fog in the background colour when the
 * shot has haze, and the seeded dust motes of shared/three/motes.ts as
 * Points of the highlight colour, repositioned per (sub-)frame from their
 * drift, which is a pure function of the frame.
 */
import { BufferAttribute, BufferGeometry, FogExp2, Points, PointsMaterial } from 'three';
import type { Scene } from 'three';
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';
import { moteSizeM, threeMoteField, threeMoteOpacity, threeMotePositions } from '../../shared/three/motes.ts';
import type { ThreeMote } from '../../shared/three/motes.ts';
import { fogDensity } from '../../shared/three/stage.ts';

/** The fog and the motes of a shot. */
export class Atmosphere {
  private readonly fps: number;
  private readonly motes: readonly ThreeMote[];
  private readonly positions: BufferAttribute | null;

  /** Adds the fog (when the haze is above 0) and the motes (when the shot asks for any) to the scene. */
  constructor(scene: Scene, spec: ShotPageSpec) {
    this.fps = spec.fps;
    if (spec.shot.atmosphere.haze > 0) scene.fog = new FogExp2(spec.look.palette.background, fogDensity(spec.shot.atmosphere.haze));
    this.motes = threeMoteField(spec.shot, spec.baseDistanceM, spec.width / spec.height);
    if (this.motes.length === 0) {
      this.positions = null;
      return;
    }
    const geometry = new BufferGeometry();
    this.positions = new BufferAttribute(new Float32Array(this.motes.length * 3), 3);
    geometry.setAttribute('position', this.positions);
    const material = new PointsMaterial({ size: moteSizeM, sizeAttenuation: true, color: spec.look.palette.highlight, opacity: threeMoteOpacity, transparent: true, depthWrite: false });
    const points = new Points(geometry, material);
    points.name = 'motes';
    // The bounding sphere is computed once from the rest positions; the drift never exceeds 2 cm.
    this.update(0);
    geometry.computeBoundingSphere();
    scene.add(points);
  }

  /** Moves every mote to its drifted position at a (possibly fractional) frame. */
  update(frame: number): void {
    if (this.positions === null) return;
    const positions = threeMotePositions(this.motes, frame, this.fps);
    for (let index = 0; index < positions.length; index += 1) this.positions.array[index] = positions[index] ?? 0;
    this.positions.needsUpdate = true;
  }
}
