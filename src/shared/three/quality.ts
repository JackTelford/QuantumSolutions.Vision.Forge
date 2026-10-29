/**
 * The two quality knobs of the three lane that trade time for picture, and
 * the one rule that turns them down: a frame no wider than 640 px is a
 * preview or a CI frame, where the determinism and parity tests must stay
 * fast, so it renders with one sub-frame and two SSAA samples.
 */

/** Frames at most this wide render in the fast setting. */
export const fastWidthPx = 640;

/**
 * How many sub-frames of motion blur a frame accumulates (ADR 0008 decision
 * 1): six for a 360 degree shutter, four for 180, two for anything shorter;
 * one at the fast width, where the blur is given up for speed.
 */
export function subFrameCount(shutterAngleDeg: number, widthPx: number): number {
  if (widthPx <= fastWidthPx) return 1;
  if (shutterAngleDeg === 360) return 6;
  if (shutterAngleDeg === 180) return 4;
  return 2;
}

/** The SSAARenderPass sample level: 2 (four samples) for a full frame, 1 (two samples) at the fast width. */
export function ssaaSampleLevel(widthPx: number): number {
  return widthPx <= fastWidthPx ? 1 : 2;
}
