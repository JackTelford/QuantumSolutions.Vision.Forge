import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import { npmCiArguments, npmCliCandidates } from '../../src/tools/npm-cli.ts';

describe('npmCliCandidates', () => {
  it('looks beside node.exe on Windows', () => {
    assert.deepEqual(npmCliCandidates('C:\\Program Files\\nodejs\\node.exe', 'win32'), [join('C:\\Program Files\\nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js')]);
  });

  it('looks under the prefix\'s lib/node_modules first on macOS and Linux, then beside the binary', () => {
    assert.deepEqual(npmCliCandidates('/usr/local/bin/node', 'linux'), [join('/usr/local', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), join('/usr/local/bin', 'node_modules', 'npm', 'bin', 'npm-cli.js')]);
  });
});

describe('npmCiArguments', () => {
  it('runs an exact, script-free install without audit or funding noise', () => {
    assert.deepEqual(npmCiArguments('/x/npm-cli.js'), ['/x/npm-cli.js', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  });
});
