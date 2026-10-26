/**
 * Rules about who may import what: the direction between src/shared/,
 * src/browser/ and Node code, the one file that may use Node's type
 * stripper, and the one file that may call fetch.
 */
import ts from 'typescript';
import { findingAtNode, walk } from './finding.ts';
import type { Finding } from './finding.ts';
import { collectModuleSpecifiers, isRelativeSpecifier, resolveRelativeSpecifier } from './syntax-helpers.ts';

const sharedDir = 'src/shared/';
const browserDir = 'src/browser/';
const stripperOwner = 'src/harness/serve.ts';
const stripperName = 'stripTypeScriptTypes';
const fetchOwner = 'src/net/http-downloader.ts';
const probesDir = 'scripts/probes/';

/** import-direction: src/shared/ imports only src/shared/; src/browser/ imports src/shared/, src/browser/ and three; Node code never imports src/browser/; only the serve harness and the M0 probes import the stripper. */
export function importDirection(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  for (const { node, specifier } of collectModuleSpecifiers(sourceFile)) {
    const problem = importProblem(path, specifier);
    if (problem !== undefined) findings.push(findingAtNode(sourceFile, path, node, 'import-direction', problem));
  }
  if (path !== stripperOwner && !path.startsWith(probesDir)) {
    for (const node of stripperImports(sourceFile)) {
      findings.push(findingAtNode(sourceFile, path, node, 'import-direction', `Only ${stripperOwner} and ${probesDir} may import ${stripperName} from node:module (ADR 0005).`));
    }
  }
  return findings;
}

function importProblem(path: string, specifier: string): string | undefined {
  const target = isRelativeSpecifier(specifier) ? resolveRelativeSpecifier(path, specifier) : undefined;
  if (path.startsWith(sharedDir)) {
    if (target === undefined || !target.startsWith(sharedDir)) return `src/shared/ runs in Node and the browser and may import only files inside src/shared/, not "${specifier}".`;
    return undefined;
  }
  if (path.startsWith(browserDir)) {
    const allowed = target === undefined
      ? specifier === 'three' || specifier.startsWith('three/addons/')
      : target.startsWith(sharedDir) || target.startsWith(browserDir);
    return allowed ? undefined : `src/browser/ may import only src/shared/, src/browser/, "three" and "three/addons/...", not "${specifier}".`;
  }
  if (target !== undefined && target.startsWith(browserDir)) return `Node code must not import src/browser/ ("${specifier}").`;
  return undefined;
}

function stripperImports(sourceFile: ts.SourceFile): ts.ImportSpecifier[] {
  const found: ts.ImportSpecifier[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (moduleName !== 'node:module' && moduleName !== 'module') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === stripperName) found.push(element);
    }
  }
  return found;
}

/** fetch-confined: the global fetch is called only in the downloader, under tests/ and under scripts/probes/. */
export function fetchConfined(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  if (path === fetchOwner || path.startsWith('tests/') || path.startsWith(probesDir)) return [];
  const findings: Finding[] = [];
  walk(sourceFile, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
      findings.push(findingAtNode(sourceFile, path, node, 'fetch-confined', `Network access goes through ${fetchOwner} only; do not call fetch here.`));
    }
  });
  return findings;
}
