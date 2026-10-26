/**
 * Rules about syntax that Node's type stripper or the house style rejects:
 * decorators, non-erasable constructs, inline type specifiers, extension-less
 * relative imports and the any type. tsc catches most of these too; the lint
 * also covers page-mode files that tsc may not.
 */
import ts from 'typescript';
import { findingAtNode, walk } from './finding.ts';
import type { Finding } from './finding.ts';
import { collectModuleSpecifiers, hasModifier, isRelativeSpecifier } from './syntax-helpers.ts';

/** no-decorators: decorators pass tsc but fail in the JavaScript parser after stripping. */
export function noDecorators(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  walk(sourceFile, (node) => {
    if (!ts.canHaveDecorators(node)) return;
    for (const decorator of ts.getDecorators(node) ?? []) {
      findings.push(findingAtNode(sourceFile, path, decorator, 'no-decorators', 'Decorators are not erasable syntax; Node cannot run them.'));
    }
  });
  return findings;
}

/** erasable-only: constructs the type stripper refuses (enum, runtime namespace, parameter properties, import =, export =, angle-bracket casts). A "declare" context is erased whole, so ambient enums and classes are exempt. */
export function erasableOnly(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  const report = (node: ts.Node, message: string): void => { findings.push(findingAtNode(sourceFile, path, node, 'erasable-only', message)); };
  walk(sourceFile, (node) => {
    if (ts.isEnumDeclaration(node) && !isAmbient(node)) {
      report(node, 'enum is not erasable; use an "as const" object with a union type.');
    } else if (ts.isModuleDeclaration(node) && hasRuntimeMembers(node)) {
      report(node, 'A namespace with runtime members is not erasable; keep namespaces type-only or use a module.');
    } else if (ts.isConstructorDeclaration(node) && !isAmbient(node)) {
      for (const parameter of node.parameters) {
        if (ts.isParameterPropertyDeclaration(parameter, node)) report(parameter, 'Parameter properties are not erasable; declare the field and assign it in the constructor.');
      }
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
      report(node, '"import x = ..." is not erasable; use an ES import.');
    } else if (ts.isExportAssignment(node) && node.isExportEquals === true) {
      report(node, '"export =" is not erasable; use ES exports.');
    } else if (ts.isTypeAssertionExpression(node)) {
      report(node, 'Angle-bracket type assertions are not erasable; use "as".');
    }
  });
  return findings;
}

function hasRuntimeMembers(node: ts.ModuleDeclaration): boolean {
  if (isAmbient(node) || ts.isStringLiteral(node.name)) return false;
  if (node.body === undefined || !ts.isModuleBlock(node.body)) return false;
  return node.body.statements.some((statement) => !isTypeOnlyStatement(statement));
}

/** True inside a "declare" context, where nothing has a runtime. */
function isAmbient(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (hasModifier(current, ts.SyntaxKind.DeclareKeyword)) return true;
  }
  return false;
}

function isTypeOnlyStatement(statement: ts.Statement): boolean {
  return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isModuleDeclaration(statement);
}

/** import-type-only: "import { type X }" and "export { type X } from" leave a side-effect import after stripping; type-only imports and re-exports use "import type" and "export type". */
export function importTypeOnly(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  const report = (element: ts.ImportSpecifier | ts.ExportSpecifier, form: string): void => {
    findings.push(findingAtNode(sourceFile, path, element, 'import-type-only', `Inline "type" on "${element.name.text}"; move it to a separate "${form}" declaration.`));
  };
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        if (element.isTypeOnly) report(element, 'import type { ... }');
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) report(element, 'export type { ... } from');
      }
    }
  }
  return findings;
}

/** ts-extension: Node resolves relative imports literally, so every relative specifier names its .ts file. */
export function tsExtension(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  return collectModuleSpecifiers(sourceFile)
    .filter(({ specifier }) => isRelativeSpecifier(specifier) && !specifier.endsWith('.ts'))
    .map(({ node, specifier }) => findingAtNode(sourceFile, path, node, 'ts-extension', `Relative import "${specifier}" must end with ".ts".`));
}

/** no-any: the any type anywhere, including casts and type arguments. */
export function noAny(sourceFile: ts.SourceFile, _text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  walk(sourceFile, (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      findings.push(findingAtNode(sourceFile, path, node, 'no-any', 'The any type is not allowed; use unknown and narrow it.'));
    }
  });
  return findings;
}
