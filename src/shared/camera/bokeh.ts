/**
 * The three lane's depth of field from the thin-lens model (ADR 0008
 * decision 1): three's BokehPass blurs a pixel by
 * `clamp((focus - depth) * aperture, -maxblur, maxblur)` in frame
 * fractions, so `aperture` is the circle of confusion per metre of
 * defocus, taken from the thin lens at the focus distance: the circle of
 * confusion of a point at distance d when focused at s is
 * c = (f² / N) · |d − s| / (d · (s − f)) (every length in metres, f the
 * focal length and N the f-number), which near the focus plane is
 * |d − s| · f² / (N · s · (s − f)). Divided by the sensor height it is a
 * fraction of the frame; halved it is the pass's radius. The blur is
 * capped so a far background never smears across the frame.
 */
import { sensorHeightMm } from './model.ts';

/** What BokehPass is given: the focus distance in metres, the aperture factor and the blur cap, both in fractions of the frame. */
export interface BokehParameters {
  readonly focusM: number;
  readonly aperture: number;
  readonly maxBlur: number;
}

/** The largest blur radius as a fraction of the frame height: 1.5 percent, a soft background without the halo artefacts of the pass's fixed kernel beyond that. */
export const bokehMaxBlur = 0.015;

/** The circle of confusion on the sensor, as a fraction of the sensor height, of a point at `distanceM` when the lens focuses at `focusM`. */
export function circleOfConfusionFraction(focalMm: number, fStop: number, focusM: number, distanceM: number, aspect: number): number {
  const f = focalMm / 1000;
  const sensorHeightM = sensorHeightMm(aspect) / 1000;
  if (distanceM <= 0 || focusM <= f) return 0;
  return ((f * f) / fStop) * Math.abs(distanceM - focusM) / (distanceM * (focusM - f)) / sensorHeightM;
}

/** The BokehPass parameters of a lens: the aperture factor is half the circle of confusion per metre of defocus at the focus plane. */
export function bokehParameters(focalMm: number, fStop: number, focusM: number, aspect: number): BokehParameters {
  const f = focalMm / 1000;
  const sensorHeightM = sensorHeightMm(aspect) / 1000;
  const perMetre = focusM <= f ? 0 : ((f * f) / fStop) / (focusM * (focusM - f)) / sensorHeightM;
  return { focusM, aperture: perMetre / 2, maxBlur: bokehMaxBlur };
}
