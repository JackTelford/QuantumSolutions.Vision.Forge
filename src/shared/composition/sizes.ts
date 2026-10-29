/**
 * The shot-size table of shot-grammar.md as data: for every ShotSize the
 * range of the subject's height as a fraction of the frame height, the
 * fraction the solver aims at (the middle of the range), and the headroom
 * and lead-room ranges of composition/rules.md. Every value is a fraction
 * of the frame (0..1 of the height for sizes and headroom, 0..1 of the
 * width for lead room), never a percentage.
 */
import type { ShotSize } from '../contracts/shot-spec.ts';

/** A closed range [min, max] of a frame fraction. */
export interface FractionRange {
  readonly min: number;
  readonly max: number;
}

/**
 * The subject's height as a fraction of the frame height for each size
 * (shot-grammar.md). ECU is above 1 because the frame sits inside the
 * subject. ELS is "under 0.15" in the table; its lower bound here is a
 * decision: 0.05 keeps the subject visible in an establishing shot.
 */
export const shotSizeRanges: Readonly<Record<ShotSize, FractionRange>> = {
  ECU: { min: 1.5, max: 2.5 },
  CU: { min: 0.7, max: 0.9 },
  MCU: { min: 0.55, max: 0.7 },
  MS: { min: 0.4, max: 0.55 },
  MLS: { min: 0.3, max: 0.4 },
  FS: { min: 0.25, max: 0.3 },
  LS: { min: 0.15, max: 0.25 },
  ELS: { min: 0.05, max: 0.15 },
};

/** The subject height fraction the solver aims at for a size: the middle of its range (MS 0.475, CU 0.8, ECU 2.0). */
export function targetFraction(size: ShotSize): number {
  const range = shotSizeRanges[size];
  return (range.min + range.max) / 2;
}

/** The headroom of the sizes that have one: 8 to 12 percent of the frame height above the subject for MS, MCU and CU. */
export const constrainedHeadroomRange: FractionRange = { min: 0.08, max: 0.12 };

/** The headroom of an ECU: none, the frame is inside the subject. */
export const noHeadroomRange: FractionRange = { min: 0, max: 0 };

/**
 * The headroom range of a size as a fraction of the frame height between
 * the top edge and the subject's top: 0.08 to 0.12 for MS, MCU and CU,
 * 0 for ECU, null for MLS and wider, where the composition anchor decides
 * (shot-grammar.md, composition/rules.md).
 */
export function headroomRange(size: ShotSize): FractionRange | null {
  switch (size) {
    case 'MS':
    case 'MCU':
    case 'CU':
      return constrainedHeadroomRange;
    case 'ECU':
      return noHeadroomRange;
    default:
      return null;
  }
}

/** True when the size's headroom is a positive range the solver must place the subject into (MS, MCU, CU). */
export function headroomGovernsSize(size: ShotSize): boolean {
  const range = headroomRange(size);
  return range !== null && range.max > 0;
}

/** The lead room every size shares: 15 to 30 percent of the frame width in front of a subject that has a direction. */
export const leadRoomRange: FractionRange = { min: 0.15, max: 0.3 };
