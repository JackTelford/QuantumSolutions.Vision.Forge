/**
 * SPDX license identifiers this repository accepts for packages under
 * node_modules. Everything else fails the check in scripts/licenses.ts:
 * copyleft licenses, a missing license, "UNLICENSED", "SEE LICENSE IN ..."
 * and "Proprietary". Widen this list only with the owner's approval and an
 * explanation in the commit, as the PSF-2.0 entry shows; NOTICE requires
 * every dependency to stay compatible with GPL version 3.
 *
 * This list covers npm packages only. Asset licenses such as OFL-1.1 for
 * fonts and CC0-1.0 or CC-BY-4.0 for HDRIs and textures are tracked by the
 * asset ledger, not by this check; CC0-1.0 and Unlicense are listed here
 * for the npm packages that publish public-domain code under them.
 */

/** Accepted SPDX identifiers, compared exactly (case-sensitive). */
export const allowedLicenses = [
  'MIT',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'Python-2.0',
  // PSF-2.0 is the Python Software Foundation License alone, the first of the
  // texts that make up Python-2.0 (https://spdx.org/licenses/PSF-2.0.html).
  // Declared by argparse 3.0.4, a dev-only dependency (json-schema-to-typescript
  // > js-yaml > argparse), whose LICENSE file is exactly that text:
  // https://unpkg.com/argparse@3.0.4/LICENSE (argparse 2.0.1 declared Python-2.0).
  // Added 2026-10-26 by M0b; remove it and the check fails on argparse 3.0.4.
  'PSF-2.0',
  'BlueOak-1.0.0',
  'Unlicense',
  'CC0-1.0',
] as const;

/** One of the identifiers in allowedLicenses. */
export type AllowedLicense = (typeof allowedLicenses)[number];

/** True when the identifier is on the allowlist (exact match). */
export function isAllowedLicense(id: string): id is AllowedLicense {
  return (allowedLicenses as readonly string[]).includes(id);
}
