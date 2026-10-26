/**
 * Rules about what every export must carry: a JSDoc comment directly above
 * it and, for functions and public methods, an explicit return type.
 * Generated files (marked @generated in the first five lines, such as
 * src/shared/contracts/) are exempt from both.
 */
import ts from 'typescript';
import { findingAtNode } from './finding.ts';
import type { Finding } from './finding.ts';
import { hasModifier, isExported, isGenerated } from './syntax-helpers.ts';

/** A top-level exported declaration, or a public method of an exported class. */
interface ExportedItem {
  readonly node: ts.Node;
  readonly kind: 'function' | 'class' | 'interface' | 'type alias' | 'variable' | 'method';
  readonly name: string;
  /** True for an overload signature or implementation that follows a same-named declaration; the doc lives on the first one. */
  readonly continuesOverload: boolean;
}

/** export-docs: every exported declaration and every public method of an exported class has a JSDoc comment directly above it; generated files are exempt. */
export function exportDocs(sourceFile: ts.SourceFile, text: string, path: string): Finding[] {
  if (isGenerated(text)) return [];
  const findings: Finding[] = [];
  for (const item of exportedItems(sourceFile)) {
    if (item.continuesOverload || hasJsDocDirectlyAbove(sourceFile, item.node)) continue;
    findings.push(findingAtNode(sourceFile, path, item.node, 'export-docs', `Exported ${item.kind} "${item.name}" needs a JSDoc comment (/** ... */) directly above it.`));
  }
  return findings;
}

/** explicit-return: exported functions, exported function values assigned to untyped variables, and public methods of exported classes declare their return type; generated files are exempt. */
export function explicitReturn(sourceFile: ts.SourceFile, text: string, path: string): Finding[] {
  if (isGenerated(text)) return [];
  const findings: Finding[] = [];
  const report = (node: ts.Node, what: string): void => { findings.push(findingAtNode(sourceFile, path, node, 'explicit-return', `${what} needs an explicit return type.`)); };
  for (const item of exportedItems(sourceFile)) {
    if ((ts.isFunctionDeclaration(item.node) || ts.isMethodDeclaration(item.node)) && item.node.type === undefined) {
      report(item.node, `Exported ${item.kind} "${item.name}"`);
    } else if (ts.isVariableStatement(item.node)) {
      for (const declaration of item.node.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (declaration.type !== undefined || initializer === undefined) continue;
        if ((ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && initializer.type === undefined) {
          report(declaration, `Exported function "${declaration.name.getText(sourceFile)}"`);
        }
      }
    }
  }
  return findings;
}

function exportedItems(sourceFile: ts.SourceFile): ExportedItem[] {
  const items: ExportedItem[] = [];
  let previous: ts.Statement | undefined;
  for (const statement of sourceFile.statements) {
    if (isExported(statement)) {
      if (ts.isFunctionDeclaration(statement)) {
        const name = nameText(statement.name);
        const continuesOverload = previous !== undefined && ts.isFunctionDeclaration(previous) && nameText(previous.name) === name;
        items.push({ node: statement, kind: 'function', name, continuesOverload });
      } else if (ts.isClassDeclaration(statement)) {
        items.push({ node: statement, kind: 'class', name: nameText(statement.name), continuesOverload: false });
        items.push(...publicMethods(sourceFile, statement));
      } else if (ts.isInterfaceDeclaration(statement)) {
        items.push({ node: statement, kind: 'interface', name: statement.name.text, continuesOverload: false });
      } else if (ts.isTypeAliasDeclaration(statement)) {
        items.push({ node: statement, kind: 'type alias', name: statement.name.text, continuesOverload: false });
      } else if (ts.isVariableStatement(statement)) {
        const name = statement.declarationList.declarations.map((declaration) => declaration.name.getText(sourceFile)).join(', ');
        items.push({ node: statement, kind: 'variable', name, continuesOverload: false });
      }
    }
    previous = statement;
  }
  return items;
}

function publicMethods(sourceFile: ts.SourceFile, classNode: ts.ClassDeclaration): ExportedItem[] {
  const items: ExportedItem[] = [];
  const className = nameText(classNode.name);
  let previous: ts.ClassElement | undefined;
  for (const member of classNode.members) {
    if (ts.isMethodDeclaration(member) && isPublic(member)) {
      const name = member.name.getText(sourceFile);
      const continuesOverload = previous !== undefined && ts.isMethodDeclaration(previous) && previous.name.getText(sourceFile) === name;
      items.push({ node: member, kind: 'method', name: `${className}.${name}`, continuesOverload });
    }
    previous = member;
  }
  return items;
}

function isPublic(member: ts.MethodDeclaration): boolean {
  return !hasModifier(member, ts.SyntaxKind.PrivateKeyword) && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword) && !ts.isPrivateIdentifier(member.name);
}

function nameText(name: ts.Identifier | undefined): string {
  return name === undefined ? 'default' : name.text;
}

/** True when a JSDoc comment ends on the line above the node (or on the same line), with nothing but whitespace between. */
function hasJsDocDirectlyAbove(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  const text = sourceFile.text;
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const last = ranges[ranges.length - 1];
  if (last === undefined || last.kind !== ts.SyntaxKind.MultiLineCommentTrivia) return false;
  if (!text.startsWith('/**', last.pos) || last.end - last.pos < 5) return false;
  const between = text.slice(last.end, node.getStart(sourceFile));
  return /^[ \t]*(\r?\n[ \t]*)?$/.test(between);
}
