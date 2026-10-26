/**
 * License allowlist check and third-party notice generator.
 *
 *   node scripts/licenses.ts           prints every installed package (name,
 *                                      version, license, prod/dev) to standard
 *                                      error and exits 1 when any license is
 *                                      missing, unparseable or not allowed
 *   node scripts/licenses.ts --write   also regenerates THIRD-PARTY.md and the
 *                                      production license texts and NOTICE
 *                                      files under docs/licenses/ when the
 *                                      check passes
 *   --root <dir>                       check another project root (tests)
 *
 * Exit codes follow the CLI: 0 success, 1 failure, 2 usage.
 *
 * Known limitation: the writes are plain, not atomic. A crash or Ctrl+C in
 * the middle of --write can leave a truncated THIRD-PARTY.md or a partly
 * updated docs/licenses/; running --write again repairs both.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../src/cli/arguments.ts';
import { ExitCodes, describeError } from '../src/errors/vision-forge-error.ts';
import { checkLicenses } from '../src/licenses/check.ts';
import type { LicenseCheckReport } from '../src/licenses/check.ts';
import { readInstalledPackages } from '../src/licenses/installed-packages.ts';
import { copyProductionLicenses } from '../src/licenses/license-files.ts';
import { renderThirdPartyNotice } from '../src/licenses/notice.ts';
import { externalPrograms, narrationComponents } from '../src/licenses/notice-extras.ts';
import { formatLicenseTable } from '../src/licenses/table.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function log(text: string): void {
  process.stderr.write(`${text}\n`);
}

function writeOutputs(root: string, report: LicenseCheckReport): void {
  const noticePath = join(root, 'THIRD-PARTY.md');
  writeFileSync(noticePath, renderThirdPartyNotice(report.checks, { externalPrograms, narrationComponents }), 'utf8');
  const copies = copyProductionLicenses(root, report.checks, join(root, 'docs', 'licenses'));
  const licenseCount = copies.filter((copy) => copy.source !== undefined).length;
  const noticeCount = copies.filter((copy) => copy.noticeSource !== undefined).length;
  log(`Wrote ${noticePath}, ${licenseCount} license texts and ${noticeCount} NOTICE files under docs/licenses/.`);
  for (const copy of copies) {
    if (copy.source === undefined) log(`warning: ${copy.name}@${copy.version} ships no license file; nothing was copied for it.`);
  }
}

function main(argv: readonly string[]): number {
  const args = parseArguments(argv, { strings: ['root'], flags: ['write'] });
  const rootArgument = args.string('root');
  const root = rootArgument === undefined ? repoRoot : resolve(rootArgument);
  const report = checkLicenses(readInstalledPackages(root));
  log(formatLicenseTable(report.checks));
  log('');
  for (const failure of report.failures) {
    log(`FAIL ${failure.pkg.name}@${failure.pkg.version} (${failure.pkg.path}): ${failure.reason ?? 'not allowed'}`);
  }
  log(`${report.checks.length} packages checked, ${report.failures.length} failed.`);
  if (report.failures.length > 0) {
    if (args.flag('write')) log('Nothing was written: fix the failures first.');
    return ExitCodes.failure;
  }
  if (args.flag('write')) writeOutputs(root, report);
  return ExitCodes.success;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error: unknown) {
  const described = describeError(error);
  process.stderr.write(`error: ${described.message}\n${described.hint}\n`);
  if (described.code === 'unexpected' && error instanceof Error && error.stack !== undefined) process.stderr.write(`${error.stack}\n`);
  process.exitCode = described.exitCode;
}
