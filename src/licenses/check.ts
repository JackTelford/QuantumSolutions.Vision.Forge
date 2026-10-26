/**
 * Judges every installed package against the allowlist after applying the
 * explicit overrides. A package fails when it declares no license, when the
 * declaration is not an SPDX expression, or when the allowlist does not
 * satisfy the expression.
 */
import { isAllowedLicense } from './allowlist.ts';
import type { InstalledPackage } from './installed-packages.ts';
import { licenseOverrideFor } from './overrides.ts';
import { judgeLicenseExpression } from './spdx.ts';
import type { LicensePredicate } from './spdx.ts';

/** The verdict for one package. */
export interface LicenseCheck {
  readonly pkg: InstalledPackage;
  /** The expression that was judged: the override when one exists, else the declared license. */
  readonly license: string | undefined;
  readonly overridden: boolean;
  readonly allowed: boolean;
  /** Why the package failed; undefined when it is allowed. */
  readonly reason: string | undefined;
}

/** Every verdict and the failures among them. */
export interface LicenseCheckReport {
  readonly checks: readonly LicenseCheck[];
  readonly failures: readonly LicenseCheck[];
}

/** Looks up an override expression for a package version. */
export type OverrideLookup = (name: string, version: string) => string | undefined;

/** Judges one package. */
export function checkPackage(pkg: InstalledPackage, isAllowed: LicensePredicate = isAllowedLicense, overrideFor: OverrideLookup = licenseOverrideFor): LicenseCheck {
  const override = overrideFor(pkg.name, pkg.version);
  const license = override ?? pkg.license;
  if (license === undefined) return { pkg, license, overridden: false, allowed: false, reason: 'no license declared in package.json' };
  const verdict = judgeLicenseExpression(license, isAllowed);
  return { pkg, license, overridden: override !== undefined, allowed: verdict.allowed, reason: verdict.reason };
}

/** Judges every package; the verdicts and failures keep the input order. */
export function checkLicenses(packages: readonly InstalledPackage[], isAllowed: LicensePredicate = isAllowedLicense, overrideFor: OverrideLookup = licenseOverrideFor): LicenseCheckReport {
  const checks = packages.map((pkg) => checkPackage(pkg, isAllowed, overrideFor));
  return { checks, failures: checks.filter((check) => !check.allowed) };
}
