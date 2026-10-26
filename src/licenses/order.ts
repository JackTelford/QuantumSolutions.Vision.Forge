/**
 * The one ordering every license output shares: by package name, then by
 * version, both compared as plain strings so the same lock file gives the
 * same order on every machine. The "name@version" key identifies one
 * package version in the notice rows and the override table.
 */

/** Anything that carries a package name and version. */
export interface NameVersion {
  readonly name: string;
  readonly version: string;
}

/** Orders by name, then by version; 0 only when both are equal. */
export function compareNameVersion(a: NameVersion, b: NameVersion): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
}

/** The "name@version" key of one package version. */
export function nameVersionKey(pkg: NameVersion): string {
  return `${pkg.name}@${pkg.version}`;
}
