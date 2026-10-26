/**
 * Finds the files to lint, runs every rule over each and formats the result.
 * Paths in findings are relative to the lint root with forward slashes, so
 * the output is identical on every platform and the path-based rules key on
 * the same strings everywhere. A path that is missing or outside the root is
 * a usage error (exit 2); a file system call that fails is a data file error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { DataFileError, UsageError } from '../errors/vision-forge-error.ts';
import { compareFindings } from './finding.ts';
import type { Finding } from './finding.ts';
import { allRules } from './rules.ts';

/** The directories the lint walks by default, relative to the root. */
export const lintRoots: readonly string[] = ['src', 'scripts', 'tests'];

/** Root-relative directories whose contents a directory walk never lints (fixtures violate rules on purpose). */
export const excludedDirs: readonly string[] = ['tests/fixtures'];

const pathHint = 'Check the path given to the lint.';

/** What one lint run produced. */
export interface LintReport {
  readonly findings: readonly Finding[];
  readonly fileCount: number;
}

/** A path relative to the root with forward slashes, as rules and output see it. */
export function rootRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

/** Every .ts file under the default roots, sorted by root-relative path. */
export function discoverFiles(root: string): string[] {
  const files: string[] = [];
  for (const dir of lintRoots) collectTsFiles(root, join(root, dir), files);
  return sortByRelativePath(root, files);
}

/** Expands a mix of files and directories into the files to lint, each file once, sorted by root-relative path. */
export function expandPaths(root: string, paths: readonly string[]): string[] {
  const files: string[] = [];
  for (const path of paths) {
    const absolute = resolve(path);
    const rel = relative(root, absolute);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new UsageError(`${path} is outside the lint root ${root}.`, 'Pass --root <dir> that contains every path, or omit --root.');
    }
    if (!existsSync(absolute)) throw new UsageError(`${absolute} does not exist.`, 'Check the paths given to the lint.');
    if (statPath(absolute).isDirectory()) collectTsFiles(root, absolute, files);
    else files.push(absolute);
  }
  return sortByRelativePath(root, [...new Set(files)]);
}

/** Lints one file's text under its root-relative path. */
export function lintSource(path: string, text: string): Finding[] {
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return allRules.flatMap((rule) => rule(sourceFile, text, path)).sort(compareFindings);
}

/** Lints the given files (absolute paths), reporting them relative to the root. */
export function lintFiles(root: string, files: readonly string[]): LintReport {
  const findings: Finding[] = [];
  for (const file of files) findings.push(...lintSource(rootRelative(root, file), readText(file)));
  return { findings: findings.sort(compareFindings), fileCount: files.length };
}

/** One finding as "path:line:col rule message". */
export function formatFinding(finding: Finding): string {
  return `${finding.path}:${finding.line}:${finding.col} ${finding.rule} ${finding.message}`;
}

/** The one-line summary of a run. */
export function formatSummary(report: LintReport): string {
  const count = report.findings.length;
  return count === 0 ? `lint: no findings in ${report.fileCount} file(s).` : `lint: ${count} finding(s) in ${report.fileCount} file(s).`;
}

function collectTsFiles(root: string, dir: string, into: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readEntries(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || excludedDirs.includes(rootRelative(root, full))) continue;
      collectTsFiles(root, full, into);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      into.push(full);
    }
  }
}

function sortByRelativePath(root: string, files: string[]): string[] {
  return files.sort((a, b) => {
    const left = rootRelative(root, a);
    const right = rootRelative(root, b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error: unknown) {
    throw new DataFileError(dir, causeOf(error), pathHint);
  }
}

function statPath(file: string): Stats {
  try {
    return statSync(file);
  } catch (error: unknown) {
    throw new DataFileError(file, causeOf(error), pathHint);
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error: unknown) {
    throw new DataFileError(file, causeOf(error), pathHint);
  }
}

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
