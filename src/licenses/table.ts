/**
 * The fixed-width table scripts/licenses.ts prints to standard error: one
 * line per package with its name, version, license and whether it is a
 * production or a development dependency, sorted by name.
 */
import type { LicenseCheck } from './check.ts';
import { comparePackagePaths } from './installed-packages.ts';
import { missingLicenseText } from './notice.ts';
import { compareNameVersion } from './order.ts';

/** Renders rows as left-aligned columns separated by two spaces; the first row is the header. */
export function formatColumns(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, cell.length); });
  }
  return rows
    .map((row) => row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join('  ').trimEnd())
    .join('\n');
}

/** Name, then version, then the unique path for two copies of the same version. */
function compareChecks(a: LicenseCheck, b: LicenseCheck): number {
  return compareNameVersion(a.pkg, b.pkg) || comparePackagePaths(a.pkg, b.pkg);
}

/** The package table: name, version, license (marked when overridden) and prod/dev. */
export function formatLicenseTable(checks: readonly LicenseCheck[]): string {
  const rows = [...checks].sort(compareChecks).map((check) => [
    check.pkg.name,
    check.pkg.version,
    `${check.license ?? missingLicenseText}${check.overridden ? ' (override)' : ''}`,
    check.pkg.dev ? 'dev' : 'prod',
  ]);
  return formatColumns([['name', 'version', 'license', 'prod/dev'], ...rows]);
}
