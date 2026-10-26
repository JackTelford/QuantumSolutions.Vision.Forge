/**
 * Reads the fields of a package.json that the license check cares about:
 * the declared license in its current and legacy shapes, and the
 * repository URL in its many spellings, normalized to one https URL.
 */

/** A JSON object. */
export type JsonRecord = Readonly<Record<string, unknown>>;

/** True for a non-null object that is not an array. */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A license entry as a string or a legacy {type} object. */
function licenseEntry(value: unknown): string | undefined {
  return nonEmptyString(value) ?? (isRecord(value) ? nonEmptyString(value['type']) : undefined);
}

/**
 * The declared license as an SPDX expression text: the "license" string,
 * the legacy {type} object, or the legacy "licenses" array joined with OR
 * (npm documents that array as a choice). Undefined when nothing is declared.
 */
export function declaredLicense(pkg: JsonRecord): string | undefined {
  const single = licenseEntry(pkg['license']);
  if (single !== undefined) return single;
  const licenses = pkg['licenses'];
  if (!Array.isArray(licenses)) return undefined;
  const types = licenses.map((entry: unknown) => licenseEntry(entry)).filter((type): type is string => type !== undefined);
  if (types.length === 0) return undefined;
  return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
}

const shorthandHosts: Readonly<Record<string, string>> = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' };

function stripRepositorySuffixes(url: string): string {
  return url.replace(/[#?].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '');
}

/**
 * Normalizes a repository URL or npm shorthand to https://host/path without
 * a trailing .git: "git+https://…", "git://…", "ssh://git@…", "git@host:…",
 * the scp-style "git+ssh://git@host:owner/repo" that npm also accepts,
 * "owner/repo" and "github:owner/repo" all collapse to the same form.
 * Undefined when the text is not a repository location.
 */
export function normalizeRepositoryUrl(raw: string): string | undefined {
  const text = raw.trim();
  const shorthand = /^(?:([a-z]+):)?([\w.-]+\/[\w.-]+)$/.exec(text);
  if (shorthand !== null) {
    const host = shorthandHosts[shorthand[1] ?? 'github'];
    return host === undefined ? undefined : stripRepositorySuffixes(`https://${host}/${shorthand[2] ?? ''}`);
  }
  const url = text.replace(/^git\+/, '');
  const scpLike = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url);
  if (scpLike !== null) return stripRepositorySuffixes(`https://${scpLike[1] ?? ''}/${scpLike[2] ?? ''}`);
  const withScheme = /^(?:git|ssh|https?):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?[/:](.+)$/.exec(url);
  if (withScheme !== null) return stripRepositorySuffixes(`https://${withScheme[1] ?? ''}/${withScheme[2] ?? ''}`);
  return undefined;
}

/** The repository URL from the "repository" string or {url} object, normalized; undefined when absent or unusable. */
export function repositoryUrl(pkg: JsonRecord): string | undefined {
  const repository = pkg['repository'];
  const raw = nonEmptyString(repository) ?? (isRecord(repository) ? nonEmptyString(repository['url']) : undefined);
  return raw === undefined ? undefined : normalizeRepositoryUrl(raw);
}
