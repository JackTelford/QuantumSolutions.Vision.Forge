import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PageInitError, PageSeekError, RendererMismatchError, withConsoleTail } from '../../src/harness/page-error.ts';

describe('RendererMismatchError', () => {
  it('tells a hardware policy to try any or software, never the policy it already has', () => {
    const error = new RendererMismatchError('hardware', 'Google SwiftShader');
    assert.equal(error.code, 'renderer-mismatch');
    assert.equal(error.exitCode, 1);
    assert.ok(error.message.includes('"hardware"') && error.message.includes('Google SwiftShader'), error.message);
    assert.ok(error.hint.includes('--renderer any') && error.hint.includes('--renderer software'), error.hint);
    assert.equal(error.hint.includes('--renderer hardware'), false);
  });

  it('tells a software policy to try any or hardware', () => {
    const error = new RendererMismatchError('software', 'ANGLE (NVIDIA, D3D11)');
    assert.ok(error.hint.includes('--renderer any') && error.hint.includes('--renderer hardware'), error.hint);
    assert.equal(error.hint.includes('--renderer software'), false);
  });

  it('names a browser without WebGL under policy any as such, since no policy fixes that', () => {
    const error = new RendererMismatchError('any', 'no usable WebGL context (no report)');
    assert.ok(error.message.includes('no usable WebGL context under either renderer'), error.message);
    assert.ok(error.hint.includes('doctor'), error.hint);
    assert.equal(error.hint.includes('--renderer'), false);
  });
});

describe('page errors', () => {
  it('append the console tail to the message and keep a copy of it', () => {
    const init = new PageInitError('http://127.0.0.1:1/page/index.html', 'The page said no.', ['first', 'second']);
    assert.equal(init.code, 'page-init');
    assert.equal(init.message, 'The page said no. Console: first | second');
    assert.deepEqual(init.consoleTail, ['first', 'second']);
    assert.ok(init.hint.includes('--verbose'), init.hint);
    const seek = new PageSeekError('http://127.0.0.1:1/page/index.html', 7, 'the seek threw.', []);
    assert.equal(seek.code, 'page-seek');
    assert.equal(seek.message, 'Frame 7: the seek threw.');
    assert.equal(seek.frame, 7);
    assert.equal(withConsoleTail('plain', []), 'plain');
  });
});
