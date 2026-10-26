import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeSpecs, parseArguments } from '../../src/cli/arguments.ts';
import { UsageError } from '../../src/errors/vision-forge-error.ts';

const spec = { strings: ['out', 'fps'], flags: ['pretty'] };

describe('parseArguments', () => {
  it('reads --name value, --name=value and flags, keeping positionals in order', () => {
    const args = parseArguments(['render', '--out', 'x', '--fps=30', '--pretty', 'extra'], spec);
    assert.deepEqual(args.positionals, ['render', 'extra']);
    assert.equal(args.string('out'), 'x');
    assert.equal(args.number('fps'), 30);
    assert.equal(args.flag('pretty'), true);
    assert.equal(args.string('missing'), undefined);
    assert.equal(args.flag('missing'), false);
  });

  it('rejects unknown options and names the allowed ones', () => {
    assert.throws(() => parseArguments(['--bogus'], spec), (error: unknown) => error instanceof UsageError && /Unknown option --bogus/.test(error.message) && /--out <value>/.test(error.hint));
  });

  it('rejects a string option without a value', () => {
    assert.throws(() => parseArguments(['--out'], spec), UsageError);
    assert.throws(() => parseArguments(['--out', '--pretty'], spec), UsageError);
  });

  it('rejects a flag given a value', () => {
    assert.throws(() => parseArguments(['--pretty=yes'], spec), UsageError);
  });

  it('requireString explains what the option is for', () => {
    const args = parseArguments([], spec);
    assert.throws(() => args.requireString('out', 'where to write'), (error: unknown) => error instanceof UsageError && /where to write/.test(error.hint));
  });

  it('number rejects non-numeric values', () => {
    assert.throws(() => parseArguments(['--fps', 'fast'], spec).number('fps'), UsageError);
  });

  it('mergeSpecs concatenates both lists', () => {
    const merged = mergeSpecs({ strings: ['a'], flags: ['b'] }, { strings: ['c'], flags: [] });
    assert.deepEqual(merged, { strings: ['a', 'c'], flags: ['b'] });
  });
});
