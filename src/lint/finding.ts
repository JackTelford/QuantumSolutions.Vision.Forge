/**
 * What a lint rule produces, and the helpers that place a finding at a node
 * or a text position. A rule is a pure function of a parsed source file, its
 * text and its root-relative path.
 */
import ts from 'typescript';

/** One rule violation at a 1-based line and column. */
export interface Finding {
  /** Path relative to the lint root, with forward slashes. */
  readonly path: string;
  readonly line: number;
  readonly col: number;
  /** The stable rule id, for example "no-any". */
  readonly rule: string;
  readonly message: string;
}

/** A lint rule: inspects one file and returns its findings. */
export type Rule = (sourceFile: ts.SourceFile, text: string, path: string) => Finding[];

/** A finding at a character offset of the source file. */
export function findingAt(sourceFile: ts.SourceFile, path: string, position: number, rule: string, message: string): Finding {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return { path, line: line + 1, col: character + 1, rule, message };
}

/** A finding at the first token of a node, after its leading trivia. */
export function findingAtNode(sourceFile: ts.SourceFile, path: string, node: ts.Node, rule: string, message: string): Finding {
  return findingAt(sourceFile, path, node.getStart(sourceFile), rule, message);
}

/** A finding at an explicit 1-based line and column, for text-based rules. */
export function findingAtLine(path: string, line: number, col: number, rule: string, message: string): Finding {
  return { path, line, col, rule, message };
}

/** Calls visit on the node and on every descendant, in source order. */
export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => { walk(child, visit); });
}

/** Orders findings by path, line, column and rule so output is stable. */
export function compareFindings(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.col !== b.col) return a.col - b.col;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  return 0;
}
