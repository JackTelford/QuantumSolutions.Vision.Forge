/**
 * Copies the license text of every production dependency into
 * docs/licenses/<name>-<version>.txt and, when the package ships one, its
 * NOTICE file into docs/licenses/<name>-<version>-NOTICE.txt (Apache-2.0
 * section 4(d) asks redistributions to carry those attributions). A scoped
 * name loses its "@" and its "/" becomes "-". Line endings are normalized
 * to LF to match the repository's text policy. Stale copies are removed, so
 * the directory holds exactly the current production set.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LicenseCheck } from './check.ts';
import { compareNameVersion } from './order.ts';

/** What happened for one production package. */
export interface CopiedLicense {
  readonly name: string;
  readonly version: string;
  /** File name of the license copy under the destination directory. */
  readonly file: string;
  /** The license file that was copied, relative to the package directory; undefined when the package ships none. */
  readonly source: string | undefined;
  /** File name of the NOTICE copy under the destination directory. */
  readonly noticeFile: string;
  /** The NOTICE file that was copied, relative to the package directory; undefined when the package ships none. */
  readonly noticeSource: string | undefined;
}

const licenseFilePattern = /^(licen[cs]e|copying)(\.(md|txt|markdown|rst))?$/i;
const noticeFilePattern = /^notice(\.(md|txt))?$/i;

/** The stem shared by a package's copies: scope "@" dropped, "/" replaced by "-", then the version. */
function copyStem(name: string, version: string): string {
  return `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}`;
}

/** The license copy's file name, for example img-sharp-win32-x64-0.34.5.txt. */
export function licenseCopyFileName(name: string, version: string): string {
  return `${copyStem(name, version)}.txt`;
}

/** The NOTICE copy's file name, for example playwright-core-1.64.1-NOTICE.txt. */
export function noticeCopyFileName(name: string, version: string): string {
  return `${copyStem(name, version)}-NOTICE.txt`;
}

/** Plain LICENSE first, then LICENSE.*, then COPYING variants; alphabetical within a rank. */
function licenseFileRank(name: string): number {
  const lower = name.toLowerCase();
  if (lower === 'license' || lower === 'licence') return 0;
  return lower.startsWith('licen') ? 1 : 2;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchingFiles(packageDir: string, pattern: RegExp): string[] {
  return readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name);
}

/** The license file inside a package directory, or undefined when it ships none. */
export function findLicenseFile(packageDir: string): string | undefined {
  const candidates = matchingFiles(packageDir, licenseFilePattern).sort((a, b) => licenseFileRank(a) - licenseFileRank(b) || compareText(a, b));
  return candidates[0];
}

/** The NOTICE file inside a package directory (NOTICE, NOTICE.md or NOTICE.txt, in any case, the plain name first), or undefined when it ships none. */
export function findNoticeFile(packageDir: string): string | undefined {
  const candidates = matchingFiles(packageDir, noticeFilePattern).sort((a, b) => a.length - b.length || compareText(a, b));
  return candidates[0];
}

/** Copies one text file with LF line endings and exactly one final newline. */
function copyText(from: string, to: string): void {
  const text = readFileSync(from, 'utf8').replace(/\r\n?/g, '\n');
  writeFileSync(to, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

/** Copies the license and NOTICE texts of the production packages, removes stale .txt copies, and reports one entry per package. */
export function copyProductionLicenses(projectRoot: string, checks: readonly LicenseCheck[], destinationDir: string): CopiedLicense[] {
  mkdirSync(destinationDir, { recursive: true });
  const copies: CopiedLicense[] = [];
  const written = new Set<string>();
  for (const check of [...checks].sort((a, b) => compareNameVersion(a.pkg, b.pkg))) {
    if (check.pkg.dev) continue;
    const file = licenseCopyFileName(check.pkg.name, check.pkg.version);
    if (copies.some((copy) => copy.file === file)) continue;
    const packageDir = join(projectRoot, ...check.pkg.path.split('/'));
    const source = findLicenseFile(packageDir);
    if (source !== undefined) {
      copyText(join(packageDir, source), join(destinationDir, file));
      written.add(file);
    }
    const noticeFile = noticeCopyFileName(check.pkg.name, check.pkg.version);
    const noticeSource = findNoticeFile(packageDir);
    if (noticeSource !== undefined) {
      copyText(join(packageDir, noticeSource), join(destinationDir, noticeFile));
      written.add(noticeFile);
    }
    copies.push({ name: check.pkg.name, version: check.pkg.version, file, source, noticeFile, noticeSource });
  }
  for (const entry of readdirSync(destinationDir)) {
    if (entry.endsWith('.txt') && !written.has(entry)) rmSync(join(destinationDir, entry));
  }
  return copies;
}
