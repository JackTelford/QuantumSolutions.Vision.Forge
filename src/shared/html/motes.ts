/**
 * Dust motes for the html lane: small dots of the highlight colour placed
 * from the shot's seed in a volume around the subject, each drifting on a
 * slow sine of the shot time with its own phase. Everything is a pure
 * function of the seed and the frame (ADR 0006): the same shot gives the
 * same motes in Node and in the browser.
 */
import { layerTransform, worldPointToStage } from '../camera/css-transform.ts';
import { mulberry32 } from '../camera/noise.ts';
import type { Vector3 } from '../camera/types.ts';
import type { Shot } from '../contracts/shot-spec.ts';
import { rgbaCss } from '../look/css-tokens.ts';
import type { Palette } from '../look/css-tokens.ts';
import type { StageGeometry } from './stage.ts';
import { centredBox, num } from './styles.ts';
import type { StyleMap } from './styles.ts';

/** The most motes a shot draws, whatever the shot asks for. */
export const maxMotes = 300;

/** The volume's width and height as a multiple of the frame at the subject's depth. */
export const moteVolumeFrameMultiple = 1.5;

/** The nearest and farthest depth of a mote in metres (the camera looks along −z, so the far side is negative). */
export const moteDepthRangeM = { near: 0.3, far: -0.4 } as const;

/** The smallest and largest mote in pixels at 1080p. */
export const moteSizeRangePx = { min: 2, max: 4 } as const;

/** The faintest and brightest mote. */
export const moteOpacityRange = { min: 0.15, max: 0.4 } as const;

/** The drift's rate in cycles per second and its amplitude in metres. */
export const moteDrift = { hz: 0.12, amplitudeM: 0.02 } as const;

/** One mote: its rest position in metres, size, opacity and drift phase. */
export interface Mote {
  readonly rest: Vector3;
  readonly sizePx: number;
  readonly opacity: number;
  /** Phase of the drift in radians, 0 to 2π. */
  readonly phase: number;
}

/** A value between lo and hi at a fraction. */
function between(lo: number, hi: number, fraction: number): number {
  return lo + (hi - lo) * fraction;
}

/** The motes of a shot, min(motes, 300) of them, placed from the shot's seed with mulberry32; none when the shot asks for none. */
export function moteField(shot: Shot, geometry: StageGeometry): readonly Mote[] {
  const count = Math.max(0, Math.min(maxMotes, Math.floor(shot.atmosphere.motes)));
  const random = mulberry32(shot.seed);
  const halfWidth = (moteVolumeFrameMultiple * geometry.frameWidthM) / 2;
  const halfHeight = (moteVolumeFrameMultiple * geometry.frameHeightM) / 2;
  const motes: Mote[] = [];
  for (let index = 0; index < count; index += 1) {
    // Six draws per mote in a fixed order, so the field is stable whatever the lane does with it.
    const x = between(-halfWidth, halfWidth, random());
    const y = between(-halfHeight, halfHeight, random());
    const z = between(moteDepthRangeM.far, moteDepthRangeM.near, random());
    const sizePx = between(moteSizeRangePx.min, moteSizeRangePx.max, random()) * geometry.scale;
    const opacity = between(moteOpacityRange.min, moteOpacityRange.max, random());
    const phase = 2 * Math.PI * random();
    motes.push({ rest: { x, y, z }, sizePx, opacity, phase });
  }
  return motes;
}

/** Where a mote is at a frame: its rest position lifted by a slow sine of the shot time, offset by its phase. */
export function motePosition(mote: Mote, frame: number, fps: number): Vector3 {
  const seconds = frame / fps;
  const drift = moteDrift.amplitudeM * Math.sin(2 * Math.PI * moteDrift.hz * seconds + mote.phase);
  return { x: mote.rest.x, y: mote.rest.y + drift, z: mote.rest.z };
}

/** The style of a mote at a frame: a round dot of the highlight colour at its drifted stage position. */
export function moteStyle(mote: Mote, frame: number, fps: number, geometry: StageGeometry, palette: Palette): StyleMap {
  return {
    ...centredBox(mote.sizePx, mote.sizePx),
    'border-radius': '50%',
    background: palette.highlight,
    opacity: num(mote.opacity),
    transform: layerTransform(worldPointToStage(motePosition(mote, frame, fps), geometry.pxPerMetre)),
  };
}
