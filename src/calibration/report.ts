/**
 * The Markdown the calibration probes write, as pure text functions of the
 * measurements, so a test can hold the formatting still: one row per
 * patch with the expected and measured YAVG, the delta, a verdict and the
 * mean colour (a neutral patch that reads warm shows it there, not in the
 * luma); one row per swatch with its mean colour and hue turn; the probe's
 * machine facts. Numbers are rounded to a tenth of a code value or a
 * degree, which is finer than any tolerance in the scene.
 */
import type { Rgb255 } from '../shared/color/hue.ts';
import type { PatchMeasurement, SwatchHueMeasurement } from './measure.ts';

/** A Markdown table from headers and rows; a pipe or a line break inside a cell is escaped or flattened so the table survives. */
export function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const lines = [`| ${headers.map(cell).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)];
  return lines.join('\n');
}

/** A number to a fixed number of decimals; "n/a" for null. A signed variant puts a plus before a non-negative value. */
export function formatNumber(value: number | null, decimals: number, signed = false): string {
  if (value === null) return 'n/a';
  const text = value.toFixed(decimals);
  return signed && value >= 0 ? `+${text}` : text;
}

/** A colour as "r, g, b" in whole code values. */
export function formatRgb(rgb: Rgb255): string {
  return `${String(rgb.r)}, ${String(rgb.g)}, ${String(rgb.b)}`;
}

/** The patch table: id, hex, expected, measured, delta, tolerance, verdict, the mean colour. */
export function patchTable(measurements: readonly PatchMeasurement[]): string {
  return markdownTable(
    ['Patch', 'Hex', 'Expected YAVG', 'Measured YAVG', 'Delta', 'Tolerance', 'Ok', 'Mean RGB'],
    measurements.map((row) => [row.id, row.hex, formatNumber(row.expectedYavg, 1), formatNumber(row.measuredYavg, 1), formatNumber(row.delta, 1, true), `±${formatNumber(row.tolerance, 0)}`, row.ok ? 'yes' : 'no', formatRgb(row.meanRgb)]),
  );
}

/** The swatch table: id, hex, the mean colour, the expected and measured hue, the turn and the saturation kept. */
export function hueTable(measurements: readonly SwatchHueMeasurement[]): string {
  return markdownTable(
    ['Swatch', 'Hex', 'Mean RGB', 'Expected hue', 'Measured hue', 'Hue delta', 'Saturation'],
    measurements.map((row) => [row.id, row.hex, formatRgb(row.rgb), `${formatNumber(row.expectedHueDeg, 0)}°`, `${formatNumber(row.measuredHueDeg, 1)}°`, `${formatNumber(row.deltaDeg, 1, true)}°`, formatNumber(row.saturation, 2)]),
  );
}

/** One line that sums a patch table up: how many patches are inside their tolerance, and the gray card's number. */
export function patchSummary(measurements: readonly PatchMeasurement[]): string {
  const ok = measurements.filter((row) => row.ok).length;
  const gray = measurements.find((row) => row.id === 'gray-18');
  const grayText = gray === undefined ? 'no gray card measured' : `gray-18 ${formatNumber(gray.measuredYavg, 1)} (${formatNumber(gray.delta, 1, true)} against ${formatNumber(gray.expectedYavg, 1)})`;
  return `${String(ok)} of ${String(measurements.length)} patches within tolerance; ${grayText}.`;
}

/** The lines of a "Not verified" list, or the one sentence that nothing is. */
export function notVerifiedSection(items: readonly string[]): string {
  const body = items.length === 0 ? ['Nothing left unverified by this probe.'] : items.map((item) => `- ${item}`);
  return ['## Not verified', '', ...body, ''].join('\n');
}
