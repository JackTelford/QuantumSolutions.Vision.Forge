/**
 * Per-package license overrides for packages whose package.json is wrong
 * but whose real license is known. Keys are "name@version" so an upgrade
 * re-triggers the check; values are SPDX expressions. Every entry needs a
 * comment with the evidence URL: the LICENSE file in the published package
 * or in the upstream repository at that version.
 *
 * Empty as of 2026-10-26: every installed package declares a parseable
 * license that matches its LICENSE file.
 */

import { nameVersionKey } from './order.ts';

/** Override expressions by "name@version". */
export const licenseOverrides: Readonly<Record<string, string>> = {};

/** The override for a package, or undefined when none applies. */
export function licenseOverrideFor(name: string, version: string): string | undefined {
  return licenseOverrides[nameVersionKey({ name, version })];
}
