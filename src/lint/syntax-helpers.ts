/**
 * Small questions about syntax trees that several rule groups ask.
 */
import ts from 'typescript';

/** True when the node carries the given modifier keyword (export, declare, private, ...). */
export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

/** True when the declaration carries the export modifier. */
export function isExported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

/** A module specifier found in an import, an export-from or a dynamic import(). */
export interface ModuleSpecifier {
  readonly node: ts.StringLiteralLike;
  readonly specifier: string;
}

/** Every module specifier in the file, in source order. */
export function collectModuleSpecifiers(sourceFile: ts.SourceFile): ModuleSpecifier[] {
  const found: ModuleSpecifier[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      found.push({ node: node.moduleSpecifier, specifier: node.moduleSpecifier.text });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteralLike(first)) found.push({ node: first, specifier: first.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** True for "./x" and "../x" specifiers. */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** The root-relative path a relative specifier names, given the importing file's root-relative path. */
export function resolveRelativeSpecifier(fromPath: string, specifier: string): string {
  const segments = fromPath.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

/** True for identifiers, string and template literal tokens and regular expression literals: the tokens that carry text. */
export function isTextToken(node: ts.Node): node is ts.Identifier | ts.PrivateIdentifier | ts.StringLiteralLike | ts.TemplateLiteralToken | ts.RegularExpressionLiteral {
  return ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isRegularExpressionLiteral(node);
}

/** True when the file is marked @generated within its first five lines; generated files are exempt from the documentation, return-type and length rules. */
export function isGenerated(text: string): boolean {
  return text.split('\n', 5).some((line) => line.includes('@generated'));
}

/** The last name in an expression like "Date" or "globalThis.performance", or undefined for anything else. */
export function tailName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}
