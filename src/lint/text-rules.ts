/**
 * Rules that read the file as tokens or as text: plugin environment
 * variables, key-like strings and file length.
 */
import ts from 'typescript';
import { findingAtLine, findingAtNode, walk } from './finding.ts';
import type { Finding } from './finding.ts';
import { isGenerated, isTextToken } from './syntax-helpers.ts';

/** The forbidden prefix, assembled so that this file passes its own rule. */
const pluginPrefix = ['CLAUDE', 'PLUGIN', ''].join('_');

/** The longest file the house allows, in lines. */
export const maxFileLines = 400;

/** Patterns of key-like strings that never belong in a repository. */
const secretPatterns: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /sk_live_[0-9a-zA-Z]{8,}/, label: 'Stripe live secret key' },
  { pattern: /whsec_[0-9a-zA-Z]{8,}/, label: 'Stripe webhook secret' },
  { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS access key id' },
  { pattern: /ghp_[0-9a-zA-Z]{20,}/, label: 'GitHub personal access token' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key block' },
  { pattern: /hf_[0-9a-zA-Z]{20,}/, label: 'Hugging Face token' },
];

/**
 * no-plugin-env: code under src/ and scripts/cli.ts never names a
 * CLAUDE_PLUGIN_* variable. Those values are substituted into skill text and
 * arrive as arguments. Identifiers, strings, templates and regular
 * expressions are checked; comments may describe the policy.
 */
export function noPluginEnv(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  if (!(path.startsWith('src/') || path === 'scripts/cli.ts')) return [];
  const findings: Finding[] = [];
  walk(sourceFile, (node) => {
    if (isTextToken(node) && node.text.includes(pluginPrefix)) {
      findings.push(findingAtNode(sourceFile, path, node, 'no-plugin-env', `${pluginPrefix}* values are substituted into skill text and passed as arguments; never read them from the environment.`));
    }
  });
  return findings;
}

/** no-secrets: key-like strings, in code or comments. */
export function noSecrets(_sourceFile: ts.SourceFile, text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  text.split('\n').forEach((line, index) => {
    for (const { pattern, label } of secretPatterns) {
      const match = pattern.exec(line);
      if (match !== null) findings.push(findingAtLine(path, index + 1, match.index + 1, 'no-secrets', `Looks like a ${label}; remove it and rotate the credential.`));
    }
  });
  return findings;
}

/** file-length: files over the limit are split; generated files (marked @generated in the first five lines) are exempt. */
export function fileLength(_sourceFile: ts.SourceFile, text: string, path: string): Finding[] {
  const lineCount = countLines(text);
  if (lineCount <= maxFileLines || isGenerated(text)) return [];
  return [findingAtLine(path, maxFileLines + 1, 1, 'file-length', `The file has ${lineCount} lines, over the ${maxFileLines} line limit; split it.`)];
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const newlines = text.split('\n').length - 1;
  return text.endsWith('\n') ? newlines : newlines + 1;
}
