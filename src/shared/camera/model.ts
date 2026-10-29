/**
 * The physical camera model shared by every lane (ADR 0008): a 36 mm sensor
 * on the larger image axis, a focal length in millimetres, an f-number and a
 * focus distance in metres. Field of view, the CSS perspective of the html
 * lane and thin-lens depth of field all derive from these four numbers, so
 * "85 mm f/4 at 1 m" frames and focuses the same everywhere.
 */

/** The sensor's size along the larger image axis, in millimetres (full frame). */
export const sensorLongEdgeMm = 36;

/**
 * The circle of confusion the depth-of-field figures use, in millimetres:
 * 0.03 mm, the standard full-frame value (the 43 mm sensor diagonal divided
 * by about 1500, the Zeiss d/1500 convention), as the M2 task mandates. The
 * depth-of-field column of lens-and-exposure.md corresponds to a wider
 * 0.045 mm circle (every row within 0.3 cm); see thinLens.
 */
export const circleOfConfusionMm = 0.03;

/** Degrees to radians. */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Radians to degrees. */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** The sensor height in millimetres: 36 / aspect for landscape (aspect >= 1), 36 for portrait, where the long edge is vertical. */
export function sensorHeightMm(aspect: number): number {
  return aspect >= 1 ? sensorLongEdgeMm / aspect : sensorLongEdgeMm;
}

/** The sensor width in millimetres: 36 for landscape, 36 × aspect for portrait. */
export function sensorWidthMm(aspect: number): number {
  return aspect >= 1 ? sensorLongEdgeMm : sensorLongEdgeMm * aspect;
}

/** Vertical field of view in degrees: 2·atan(sensorHeight / (2·focal)); 22.9 at 50 mm and 16:9. */
export function verticalFovDegrees(focalMm: number, aspect: number): number {
  return toDegrees(2 * Math.atan(sensorHeightMm(aspect) / (2 * focalMm)));
}

/** Horizontal field of view in degrees: 2·atan(sensorWidth / (2·focal)); 39.6 at 50 mm and 16:9. */
export function horizontalFovDegrees(focalMm: number, aspect: number): number {
  return toDegrees(2 * Math.atan(sensorWidthMm(aspect) / (2 * focalMm)));
}

/**
 * The CSS `perspective` in pixels that gives a 2.5D stage the same vertical
 * field of view as the 3D lanes: (viewportHeight / 2) / tan(vfov / 2), the
 * distance from the viewer to a plane that fills the viewport height.
 * 2667 px at 50 mm, 16:9 and 1080 px.
 */
export function cssPerspectivePx(focalMm: number, aspect: number, viewportHeightPx: number): number {
  return viewportHeightPx / 2 / Math.tan(toRadians(verticalFovDegrees(focalMm, aspect)) / 2);
}

/** What the thin lens says about one focus setting: aperture in millimetres, hyperfocal, near and far limits in metres. */
export interface ThinLens {
  /** The entrance pupil diameter, focal / f-number, in millimetres. */
  readonly apertureDiameterMm: number;
  /** The focus distance beyond which everything to infinity is acceptably sharp, in metres. */
  readonly hyperfocalM: number;
  /** The nearest distance that is acceptably sharp, in metres. */
  readonly nearM: number;
  /** The farthest distance that is acceptably sharp, in metres; Infinity at or beyond the hyperfocal distance. */
  readonly farM: number;
}

/**
 * Thin-lens depth of field with the full-frame circle of confusion c:
 * hyperfocal H = f² / (N·c) + f, near = H·s / (H + (s − f)), far = H·s /
 * (H − (s − f)) for a focus distance s, all in millimetres inside the
 * formula and metres outside. 85 mm at f/4 focused at 1 m gives about
 * 3.0 cm (0.985 m to 1.015 m) with the 0.03 mm circle; the lens table's
 * "about 4.5 cm" corresponds to a 0.045 mm circle.
 */
export function thinLens(focalMm: number, fStop: number, focusDistanceM: number, circleMm: number = circleOfConfusionMm): ThinLens {
  const focusMm = focusDistanceM * 1000;
  const hyperfocalMm = (focalMm * focalMm) / (fStop * circleMm) + focalMm;
  const beyondFocal = focusMm - focalMm;
  const nearMm = (hyperfocalMm * focusMm) / (hyperfocalMm + beyondFocal);
  const farMm = focusMm >= hyperfocalMm ? Number.POSITIVE_INFINITY : (hyperfocalMm * focusMm) / (hyperfocalMm - beyondFocal);
  return {
    apertureDiameterMm: focalMm / fStop,
    hyperfocalM: hyperfocalMm / 1000,
    nearM: nearMm / 1000,
    farM: farMm / 1000,
  };
}
