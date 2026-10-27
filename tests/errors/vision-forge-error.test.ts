import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CancelledError,
  DownloadIntegrityError,
  ExitCodes,
  NotImplementedError,
  ProcessFailedError,
  SchemaValidationError,
  ToolMissingError,
  UsageError,
  VisionForgeError,
  describeError,
} from '../../src/errors/vision-forge-error.ts';

describe('VisionForgeError', () => {
  it('carries code, hint and a failure exit code by default', () => {
    const error = new VisionForgeError({ code: 'x', message: 'm', hint: 'h' });
    assert.equal(error.code, 'x');
    assert.equal(error.hint, 'h');
    assert.equal(error.exitCode, ExitCodes.failure);
    assert.equal(error.name, 'VisionForgeError');
    assert.ok(error instanceof Error);
  });

  it('sets the subclass name and exit code', () => {
    assert.equal(new UsageError('m', 'h').exitCode, ExitCodes.usage);
    assert.equal(new UsageError('m', 'h').name, 'UsageError');
    assert.equal(new CancelledError().exitCode, ExitCodes.cancelled);
    assert.equal(new NotImplementedError('render', 'M3').exitCode, ExitCodes.usage);
    assert.equal(new ToolMissingError('ffmpeg', 'install it').exitCode, ExitCodes.failure);
  });

  it('keeps the cause when given', () => {
    const cause = new Error('inner');
    const error = new VisionForgeError({ code: 'x', message: 'm', hint: 'h', cause });
    assert.equal(error.cause, cause);
  });

  it('summarizes a process failure with the stderr tail and log path', () => {
    const error = new ProcessFailedError('ffmpeg', 1, 'Invalid argument', 'C:/log.txt', 'Check the filter.');
    assert.match(error.message, /ffmpeg failed with exit code 1/);
    assert.match(error.message, /Invalid argument/);
    assert.match(error.hint, /Full log: C:\/log.txt/);
  });

  it('lists at most three schema problems in the message', () => {
    const error = new SchemaValidationError('shot-spec', ['a', 'b', 'c', 'd', 'e']);
    assert.match(error.message, /a; b; c \(and 2 more\)/);
    assert.equal(error.problems.length, 5);
  });

  it('names what failed integrity', () => {
    const error = new DownloadIntegrityError('https://x/y', 'sha256', 'aa', 'bb');
    assert.match(error.message, /wrong sha256: expected aa, got bb/);
  });
});

describe('describeError', () => {
  it('carries the evidence a VisionForgeError lists and none for any other error', () => {
    const withReport = new VisionForgeError({ code: 'qa-failed', message: 'm', hint: 'h', evidence: ['C:\\out\\qa\\film.qa.json'] });
    assert.deepEqual(describeError(withReport).evidence, ['C:\\out\\qa\\film.qa.json']);
    assert.deepEqual(describeError(new UsageError('bad', 'fix')).evidence, []);
    assert.deepEqual(describeError(new Error('boom')).evidence, []);
  });

  it('passes through a VisionForgeError', () => {
    const described = describeError(new UsageError('bad', 'fix'));
    assert.deepEqual(described, { message: 'bad', hint: 'fix', code: 'usage', exitCode: 2, evidence: [] });
  });

  it('wraps a plain Error as unexpected with exit code 1', () => {
    const described = describeError(new Error('boom'));
    assert.equal(described.code, 'unexpected');
    assert.equal(described.exitCode, 1);
    assert.equal(described.message, 'boom');
  });

  it('stringifies non-errors', () => {
    assert.equal(describeError('text').message, 'text');
  });
});
