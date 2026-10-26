/**
 * The network allowlist: the only hosts this repository contacts, and the
 * hosts each of them may redirect a download to. Probe P7
 * (docs/evidence/m0/p7-redirects.md) recorded the real redirect chains and
 * ADR 0007 pins the Hugging Face download. Every URL a download touches,
 * including every redirect hop, is checked here before it is fetched.
 */
import { NetworkNotAllowedError } from '../errors/vision-forge-error.ts';

/** One host downloads may start from, with the hosts it is allowed to redirect to. */
export interface AllowedHost {
  /** Exact host name, lowercase, without a port. */
  readonly host: string;
  /** Hosts a download that started at `host` may be redirected to: exact names or `*.suffix` wildcards. */
  readonly redirectHosts: readonly string[];
  /** What the host is used for; printed by doctor and kept in the docs. */
  readonly purpose: string;
}

/** Hosts github.com sends downloads to (probe P7, plus GitHub's documented storage hosts). */
const githubRedirectHosts: readonly string[] = [
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
];

/** The production allowlist. Adding a host is an ADR-level decision. */
export const networkAllowlist: readonly AllowedHost[] = [
  { host: 'registry.npmjs.org', redirectHosts: [], purpose: 'npm packages of the optional narration component' },
  { host: 'github.com', redirectHosts: githubRedirectHosts, purpose: 'release assets and raw files, which redirect to GitHub storage hosts' },
  { host: 'raw.githubusercontent.com', redirectHosts: [], purpose: 'OFL fonts and license texts' },
  { host: 'api.github.com', redirectHosts: [], purpose: 'release metadata' },
  { host: 'api.polyhaven.com', redirectHosts: [], purpose: 'Poly Haven asset catalogue and per-file checksums' },
  { host: 'dl.polyhaven.org', redirectHosts: [], purpose: 'Poly Haven HDRI, texture and model files (CC0)' },
  { host: 'huggingface.co', redirectHosts: ['*.hf.co'], purpose: 'Kokoro weights only' },
  { host: 'cdn.playwright.dev', redirectHosts: [], purpose: 'Playwright browser only when no system browser exists' },
  { host: 'playwright.azureedge.net', redirectHosts: [], purpose: 'Playwright browser only when no system browser exists' },
];

/** Hosts that may be reached over plain http: the loopback addresses used by tests and the local harness. */
const loopbackHosts: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True when a host equals a pattern, or when the pattern is `*.suffix` and the host is a subdomain of `suffix`. */
export function hostMatches(host: string, pattern: string): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedPattern = normalizeHost(pattern);
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHost.length > suffix.length && normalizedHost.endsWith(suffix);
  }
  return normalizedHost === normalizedPattern;
}

/**
 * True when the host is in the allowlist. A host that appears only as a
 * redirect host is allowed only when `origin`, the host the download started
 * from, is an allowlisted host that lists it.
 */
export function isHostAllowed(host: string, allowlist: readonly AllowedHost[], origin?: string): boolean {
  if (allowlist.some((entry) => hostMatches(host, entry.host))) return true;
  if (origin === undefined) return false;
  return allowlist.some((entry) => hostMatches(origin, entry.host) && entry.redirectHosts.some((pattern) => hostMatches(host, pattern)));
}

/**
 * Throws NetworkNotAllowedError unless the URL is https (or http to a loopback
 * address) and its host is allowed, directly or as a redirect from originHost.
 */
export function assertUrlAllowed(url: URL, allowlist: readonly AllowedHost[], originHost?: string): void {
  const host = normalizeHost(url.hostname);
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.has(host));
  if (!secure || !isHostAllowed(host, allowlist, originHost)) {
    throw new NetworkNotAllowedError(url.hostname, url.href);
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}
