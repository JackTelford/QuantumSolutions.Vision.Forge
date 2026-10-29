/**
 * CREDITS.md: the attribution a deliverable ships with. The bundled fonts
 * are credited from the typography scale (they never go through the ledger)
 * and every downloaded asset from its ledger record.
 */
import type { AssetRecord } from '../net/asset-ledger.ts';
import { bundledFonts, fontsSourceCommit } from '../shared/typography/scale.ts';

/** The google/fonts tree the bundled files were copied from, at the pinned commit. */
const fontsSourceBase = `https://github.com/google/fonts/blob/${fontsSourceCommit}/`;

/** The credits document for the given ledger records, sorted by id. */
export function creditsMarkdown(records: readonly AssetRecord[]): string {
  const lines: string[] = [
    '# Credits',
    '',
    'The fonts and assets below are used as supplied by their sources; none is modified.',
    '',
    '## Bundled fonts',
    '',
    `The four typefaces are licensed under the SIL Open Font License 1.1 and were copied from google/fonts at commit ${fontsSourceCommit}. The license text sits beside each font file.`,
    '',
    '| Family | File | Source | License |',
    '| --- | --- | --- | --- |',
  ];
  for (const font of Object.values(bundledFonts)) {
    lines.push(`| ${font.cssFamily} | ${font.file} | ${fontsSourceBase}${font.sourcePath} | ${font.license} |`);
  }
  lines.push('', '## Downloaded assets', '');
  const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (sorted.length === 0) {
    lines.push('No assets have been downloaded.');
  } else {
    for (const record of sorted) {
      lines.push(`- \`${record.id}\`: ${record.credit ?? 'no attribution text'}. License ${record.license}. Source: ${record.source}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
