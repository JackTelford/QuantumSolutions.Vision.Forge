/**
 * The rule table. Every house rule the lint enforces is listed here once.
 */
import type { Rule } from './finding.ts';
import { explicitReturn, exportDocs } from './export-rules.ts';
import { fetchConfined, importDirection } from './import-rules.ts';
import { pageMode } from './page-mode.ts';
import { erasableOnly, importTypeOnly, noAny, noDecorators, tsExtension } from './syntax-rules.ts';
import { fileLength, noPluginEnv, noSecrets } from './text-rules.ts';

/** Every rule, in the order they run over a file. */
export const allRules: readonly Rule[] = [
  noDecorators,
  erasableOnly,
  importTypeOnly,
  tsExtension,
  exportDocs,
  explicitReturn,
  noAny,
  importDirection,
  fetchConfined,
  noPluginEnv,
  noSecrets,
  pageMode,
  fileLength,
];
