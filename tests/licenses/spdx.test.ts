import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAllowedLicense } from '../../src/licenses/allowlist.ts';
import { SpdxSyntaxError, isExpressionAllowed, judgeLicenseExpression, licenseIds, parseSpdxExpression } from '../../src/licenses/spdx.ts';

describe('spdx', () => {
  it('accepts a single identifier on the allowlist', () => {
    assert.deepEqual(judgeLicenseExpression('MIT', isAllowedLicense), { allowed: true, reason: undefined });
  });

  it('accepts an OR expression when at least one side is allowed', () => {
    assert.equal(judgeLicenseExpression('(MIT OR Apache-2.0)', isAllowedLicense).allowed, true);
    assert.equal(judgeLicenseExpression('(GPL-3.0-only OR MIT)', isAllowedLicense).allowed, true);
  });

  it('rejects an AND expression unless every side is allowed', () => {
    assert.deepEqual(judgeLicenseExpression('(MIT AND GPL-3.0)', isAllowedLicense), { allowed: false, reason: 'not on the allowlist: GPL-3.0' });
    assert.equal(judgeLicenseExpression('(MIT AND ISC)', isAllowedLicense).allowed, true);
  });

  it('judges a WITH exception by its base identifier', () => {
    const expression = parseSpdxExpression('Apache-2.0 WITH LLVM-exception');
    assert.deepEqual(expression, { kind: 'license', id: 'Apache-2.0', exception: 'LLVM-exception' });
    assert.equal(isExpressionAllowed(expression, isAllowedLicense), true);
  });

  it('binds AND tighter than OR', () => {
    const expression = parseSpdxExpression('GPL-2.0-only AND MIT OR ISC');
    assert.equal(expression.kind, 'or');
    assert.equal(isExpressionAllowed(expression, isAllowedLicense), true);
    assert.deepEqual(licenseIds(expression), ['GPL-2.0-only', 'MIT', 'ISC']);
  });

  it('rejects UNLICENSED, Proprietary and identifiers that differ only in case', () => {
    for (const text of ['UNLICENSED', 'Proprietary', 'mit']) {
      assert.deepEqual(judgeLicenseExpression(text, isAllowedLicense), { allowed: false, reason: `not on the allowlist: ${text}` });
    }
  });

  it('treats free text and malformed expressions as failures, not exceptions', () => {
    assert.deepEqual(judgeLicenseExpression('SEE LICENSE IN LICENSE', isAllowedLicense), { allowed: false, reason: 'cannot parse "SEE LICENSE IN LICENSE" (unexpected "LICENSE")' });
    for (const text of ['', '(MIT', 'MIT OR', 'MIT )', 'AND MIT', 'MIT WITH', 'MIT WITH AND']) {
      assert.equal(judgeLicenseExpression(text, isAllowedLicense).allowed, false, `"${text}" must fail`);
    }
  });

  it('parse errors carry the expression, the reason and a hint', () => {
    assert.throws(
      () => parseSpdxExpression('(MIT'),
      (error: unknown) => error instanceof SpdxSyntaxError && error.expression === '(MIT' && error.reason === 'a parenthesis is not closed' && error.hint.length > 0,
    );
  });

  it('lists every identifier once in reading order', () => {
    assert.deepEqual(licenseIds(parseSpdxExpression('(MIT OR (ISC AND MIT))')), ['MIT', 'ISC']);
  });
});
