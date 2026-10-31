/**
 * Dust motes for the three lane: points of the highlight colour placed
 * from the shot's seed in the volume html/motes.ts uses (1.5 frames wide
 * and high at the subject's depth, between 0.4 m behind and 0.3 m in
 * front of the anchor), each drifting on the same slow sine with its own
 * phase. The three lane draws them as Points, so this version keeps only
 * what Points need: rest positions and phases, as a pure function of the
 * seed and the frame.
 */
import { sensorHeightMm, sensorWidthMm } from '../camera/model.ts';
import { mulberry32 } from '../camera/noise.ts';
import type { Vector3 } from '../camera/types.ts';
import type { Shot } from '../contracts/shot-spec.ts';
import { moteDepthRangeM, moteDrift, moteVolumeFrameMultiple } from '../html/motes.ts';

/** The most motes the three lane draws, whatever the shot asks for. */
export const maxThreeMotes = 400;

/** A mote's diameter as a fraction of the frame's height at the anchor: 0.8 percent is about 9 px at 1080p before size attenuation (a 4 mm constant was invisible past 2 m: the field test of 2026-10-30). */
export const threeMoteSizeFraction = 0.008;

/** The size of a mote in metres for PointsMaterial.size with size attenuation: a fraction of the frame's height at the anchor. */
export function threeMoteSizeM(frameHeightM: number): number {
  return Math.max(0.001, frameHeightM * threeMoteSizeFraction);
}

/** The opacity of the mote points. */
export const threeMoteOpacity = 0.55;

/** One mote: where it rests and the phase of its drift in radians. */
export interface ThreeMote {
  readonly rest: Vector3;
  readonly phase: number;
}

/** The frame's width and height in metres on the plane through the anchor at the base distance, from the pinhole: distance × sensor edge / focal. */
export function frameSizeAtAnchorM(focalMm: number, baseDistanceM: number, aspect: number): { readonly widthM: number; readonly heightM: number } {
  return { widthM: (baseDistanceM * sensorWidthMm(aspect)) / focalMm, heightM: (baseDistanceM * sensorHeightMm(aspect)) / focalMm };
}

function between(lo: number, hi: number, fraction: number): number {
  return lo + (hi - lo) * fraction;
}

/** The motes of a shot, min(motes, 400) of them, from the shot's seed with mulberry32; four draws per mote in a fixed order. */
export function threeMoteField(shot: Shot, baseDistanceM: number, aspect: number): readonly ThreeMote[] {
  const count = Math.max(0, Math.min(maxThreeMotes, Math.floor(shot.atmosphere.motes)));
  const random = mulberry32(shot.seed);
  const frame = frameSizeAtAnchorM(shot.lens.focalMm, baseDistanceM, aspect);
  const halfWidth = (moteVolumeFrameMultiple * frame.widthM) / 2;
  const halfHeight = (moteVolumeFrameMultiple * frame.heightM) / 2;
  const motes: ThreeMote[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = between(-halfWidth, halfWidth, random());
    const y = between(-halfHeight, halfHeight, random());
    const z = between(moteDepthRangeM.far, moteDepthRangeM.near, random());
    const phase = 2 * Math.PI * random();
    motes.push({ rest: { x, y, z }, phase });
  }
  return motes;
}

/** Where a mote is at a (possibly fractional) frame: its rest lifted by the slow sine of the shot time, offset by its phase. */
export function threeMotePosition(mote: ThreeMote, frame: number, fps: number): Vector3 {
  const drift = moteDrift.amplitudeM * Math.sin(2 * Math.PI * moteDrift.hz * (frame / fps) + mote.phase);
  return { x: mote.rest.x, y: mote.rest.y + drift, z: mote.rest.z };
}

/** Every mote's position at a frame as one flat x, y, z list, the layout a BufferAttribute takes. */
export function threeMotePositions(motes: readonly ThreeMote[], frame: number, fps: number): readonly number[] {
  const out: number[] = [];
  for (const mote of motes) {
    const position = threeMotePosition(mote, frame, fps);
    out.push(position.x, position.y, position.z);
  }
  return out;
}
