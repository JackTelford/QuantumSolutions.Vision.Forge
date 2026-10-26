/**
 * A small parser and evaluator for SPDX license expressions, enough for
 * what package.json files declare: one identifier, parentheses, "OR",
 * "AND" and "WITH <exception>". Identifiers and operators are compared
 * exactly, as the SPDX specification writes them. Free text such as
 * "SEE LICENSE IN LICENSE" is a syntax error, and the check treats a
 * syntax error as a failure.
 *
 * "OR" is satisfied when at least one side is; "AND" only when both are;
 * a "WITH" exception is judged by its base identifier.
 */
import { VisionForgeError } from '../errors/vision-forge-error.ts';

/** One license identifier, optionally with an exception ("Apache-2.0 WITH LLVM-exception"). */
export interface SpdxLicense {
  readonly kind: 'license';
  readonly id: string;
  readonly exception: string | undefined;
}

/** Two expressions joined by AND or OR. */
export interface SpdxConjunction {
  readonly kind: 'and' | 'or';
  readonly left: SpdxExpression;
  readonly right: SpdxExpression;
}

/** A parsed expression tree. */
export type SpdxExpression = SpdxLicense | SpdxConjunction;

/** Decides whether one identifier is acceptable. */
export type LicensePredicate = (id: string) => boolean;

/** The verdict for an expression text. */
export interface LicenseVerdict {
  readonly allowed: boolean;
  /** Why the expression failed; undefined when it is allowed. */
  readonly reason: string | undefined;
}

/** The text is not an SPDX expression. */
export class SpdxSyntaxError extends VisionForgeError {
  readonly expression: string;
  readonly reason: string;

  constructor(expression: string, reason: string) {
    super({
      code: 'spdx-syntax',
      message: `Cannot parse the license expression "${expression}": ${reason}.`,
      hint: 'Package licenses must be SPDX expressions such as MIT or (MIT OR Apache-2.0). When the real license is known, add an override with its evidence in src/licenses/overrides.ts.',
    });
    this.expression = expression;
    this.reason = reason;
  }
}

const operators: readonly string[] = ['AND', 'OR', 'WITH'];

function tokenize(text: string): string[] {
  return text.replace(/([()])/g, ' $1 ').trim().split(/\s+/).filter((token) => token.length > 0);
}

function isIdentifier(token: string): boolean {
  return token !== '(' && token !== ')' && !operators.includes(token);
}

/** Recursive descent over the tokens: or-expression > and-expression > primary. */
class Parser {
  private readonly text: string;
  private readonly tokens: readonly string[];
  private index = 0;

  constructor(text: string) {
    this.text = text;
    this.tokens = tokenize(text);
  }

  parse(): SpdxExpression {
    if (this.tokens.length === 0) throw new SpdxSyntaxError(this.text, 'it is empty');
    const expression = this.parseOr();
    const rest = this.peek();
    if (rest !== undefined) throw new SpdxSyntaxError(this.text, `unexpected "${rest}"`);
    return expression;
  }

  private peek(): string | undefined {
    return this.tokens[this.index];
  }

  private take(): string | undefined {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private parseOr(): SpdxExpression {
    let left = this.parseAnd();
    while (this.peek() === 'OR') {
      this.take();
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): SpdxExpression {
    let left = this.parsePrimary();
    while (this.peek() === 'AND') {
      this.take();
      left = { kind: 'and', left, right: this.parsePrimary() };
    }
    return left;
  }

  private parsePrimary(): SpdxExpression {
    const token = this.take();
    if (token === undefined) throw new SpdxSyntaxError(this.text, 'it ends early');
    if (token === '(') {
      const inner = this.parseOr();
      if (this.take() !== ')') throw new SpdxSyntaxError(this.text, 'a parenthesis is not closed');
      return inner;
    }
    if (!isIdentifier(token)) throw new SpdxSyntaxError(this.text, `unexpected "${token}"`);
    if (this.peek() !== 'WITH') return { kind: 'license', id: token, exception: undefined };
    this.take();
    const exception = this.take();
    if (exception === undefined || !isIdentifier(exception)) throw new SpdxSyntaxError(this.text, 'WITH needs an exception name');
    return { kind: 'license', id: token, exception };
  }
}

/** Parses an expression; throws SpdxSyntaxError when the text is not one. */
export function parseSpdxExpression(text: string): SpdxExpression {
  return new Parser(text).parse();
}

/** True when the predicate satisfies the expression: OR needs one side, AND needs both, WITH uses the base id. */
export function isExpressionAllowed(expression: SpdxExpression, isAllowed: LicensePredicate): boolean {
  switch (expression.kind) {
    case 'license':
      return isAllowed(expression.id);
    case 'and':
      return isExpressionAllowed(expression.left, isAllowed) && isExpressionAllowed(expression.right, isAllowed);
    case 'or':
      return isExpressionAllowed(expression.left, isAllowed) || isExpressionAllowed(expression.right, isAllowed);
  }
}

/** Every identifier in the expression in reading order, without duplicates. */
export function licenseIds(expression: SpdxExpression): string[] {
  if (expression.kind === 'license') return [expression.id];
  const ids = [...licenseIds(expression.left), ...licenseIds(expression.right)];
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

/** Parses and judges an expression text; syntax errors and rejected identifiers become reasons, not exceptions. */
export function judgeLicenseExpression(text: string, isAllowed: LicensePredicate): LicenseVerdict {
  let expression: SpdxExpression;
  try {
    expression = parseSpdxExpression(text);
  } catch (error: unknown) {
    if (!(error instanceof SpdxSyntaxError)) throw error;
    return { allowed: false, reason: `cannot parse "${text}" (${error.reason})` };
  }
  if (isExpressionAllowed(expression, isAllowed)) return { allowed: true, reason: undefined };
  const rejected = licenseIds(expression).filter((id) => !isAllowed(id));
  return { allowed: false, reason: `not on the allowlist: ${rejected.join(', ')}` };
}
