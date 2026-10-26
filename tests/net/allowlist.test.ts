import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NetworkNotAllowedError } from '../../src/errors/vision-forge-error.ts';
import { assertUrlAllowed, hostMatches, isHostAllowed, networkAllowlist } from '../../src/net/allowlist.ts';
import type { AllowedHost } from '../../src/net/allowlist.ts';

const list = networkAllowlist;
const loopback: readonly AllowedHost[] = [{ host: '127.0.0.1', redirectHosts: ['localhost'], purpose: 'tests' }];

function entry(host: string): AllowedHost {
  const found = list.find((candidate) => candidate.host === host);
  assert.ok(found !== undefined, `${host} is in the allowlist`);
  return found;
}

describe('hostMatches', () => {
  it('matches exact names regardless of case', () => {
    assert.equal(hostMatches('github.com', 'github.com'), true);
    assert.equal(hostMatches('GitHub.com', 'github.com'), true);
    assert.equal(hostMatches('api.github.com', 'github.com'), false);
    assert.equal(hostMatches('github.com.evil.example', 'github.com'), false);
  });

  it('matches a wildcard only for subdomains of its suffix', () => {
    assert.equal(hostMatches('us.aws.cdn.hf.co', '*.hf.co'), true);
    assert.equal(hostMatches('cdn.hf.co', '*.hf.co'), true);
    assert.equal(hostMatches('hf.co', '*.hf.co'), false);
    assert.equal(hostMatches('evilhf.co', '*.hf.co'), false);
    assert.equal(hostMatches('hf.co.evil.example', '*.hf.co'), false);
  });
});

describe('isHostAllowed', () => {
  it('allows every listed host directly', () => {
    for (const allowed of list) assert.equal(isHostAllowed(allowed.host, list), true, allowed.host);
  });

  it('refuses a host that is not listed, whatever the origin', () => {
    assert.equal(isHostAllowed('evil.example', list), false);
    assert.equal(isHostAllowed('evil.example', list, 'github.com'), false);
    assert.equal(isHostAllowed('evil.example', list, 'huggingface.co'), false);
  });

  it('allows raw.githubusercontent.com directly and when reached from github.com', () => {
    assert.equal(isHostAllowed('raw.githubusercontent.com', list), true);
    assert.equal(isHostAllowed('raw.githubusercontent.com', list, 'github.com'), true);
  });

  it('allows a redirect host only when reached from the origin that lists it', () => {
    assert.equal(isHostAllowed('release-assets.githubusercontent.com', list), false);
    assert.equal(isHostAllowed('release-assets.githubusercontent.com', list, 'github.com'), true);
    assert.equal(isHostAllowed('release-assets.githubusercontent.com', list, 'huggingface.co'), false);
    assert.equal(isHostAllowed('us.aws.cdn.hf.co', list), false);
    assert.equal(isHostAllowed('us.aws.cdn.hf.co', list, 'huggingface.co'), true);
    assert.equal(isHostAllowed('us.aws.cdn.hf.co', list, 'github.com'), false);
  });

  it('ignores an origin that is not itself allowed', () => {
    assert.equal(isHostAllowed('release-assets.githubusercontent.com', list, 'evil.example'), false);
    assert.equal(isHostAllowed('localhost', loopback, 'evil.example'), false);
    assert.equal(isHostAllowed('localhost', loopback, '127.0.0.1'), true);
  });
});

describe('assertUrlAllowed', () => {
  it('accepts https URLs of listed hosts and redirect hops from their origin', () => {
    assert.doesNotThrow(() => assertUrlAllowed(new URL('https://github.com/google/fonts/raw/main/ofl/inter/OFL.txt'), list));
    assert.doesNotThrow(() => assertUrlAllowed(new URL('https://release-assets.githubusercontent.com/x'), list, 'github.com'));
    assert.doesNotThrow(() => assertUrlAllowed(new URL('https://us.aws.cdn.hf.co/x?y=1'), list, 'huggingface.co'));
  });

  it('throws NetworkNotAllowedError naming the host for an unlisted host', () => {
    assert.throws(
      () => assertUrlAllowed(new URL('https://evil.example/payload'), list, 'github.com'),
      (error: unknown) => error instanceof NetworkNotAllowedError && error.host === 'evil.example' && /evil\.example/.test(error.message),
    );
    assert.throws(() => assertUrlAllowed(new URL('https://release-assets.githubusercontent.com/x'), list), NetworkNotAllowedError);
  });

  it('refuses plain http except to loopback addresses', () => {
    assert.throws(() => assertUrlAllowed(new URL('http://github.com/x'), list), NetworkNotAllowedError);
    assert.doesNotThrow(() => assertUrlAllowed(new URL('http://127.0.0.1:8080/x'), loopback));
    assert.doesNotThrow(() => assertUrlAllowed(new URL('http://localhost:8080/x'), loopback, '127.0.0.1'));
    assert.throws(() => assertUrlAllowed(new URL('http://localhost:8080/x'), loopback), NetworkNotAllowedError);
  });

  it('refuses schemes other than http and https', () => {
    assert.throws(() => assertUrlAllowed(new URL('ftp://github.com/x'), list), NetworkNotAllowedError);
    assert.throws(() => assertUrlAllowed(new URL('file:///C:/github.com'), list), NetworkNotAllowedError);
  });
});

describe('networkAllowlist', () => {
  it('lists exactly the hosts the pipeline downloads from', () => {
    assert.deepEqual(list.map((allowed) => allowed.host), [
      'registry.npmjs.org',
      'github.com',
      'raw.githubusercontent.com',
      'api.github.com',
      'api.polyhaven.com',
      'dl.polyhaven.org',
      'huggingface.co',
      'cdn.playwright.dev',
      'playwright.azureedge.net',
    ]);
  });

  it('records the redirect hosts probe P7 observed and the purposes the ADRs fixed', () => {
    assert.deepEqual(entry('github.com').redirectHosts, ['raw.githubusercontent.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'codeload.github.com']);
    assert.deepEqual(entry('huggingface.co').redirectHosts, ['*.hf.co']);
    assert.equal(entry('huggingface.co').purpose, 'Kokoro weights only');
    assert.equal(entry('cdn.playwright.dev').purpose, 'Playwright browser only when no system browser exists');
    assert.equal(entry('playwright.azureedge.net').purpose, 'Playwright browser only when no system browser exists');
    for (const allowed of list) assert.ok(allowed.purpose.length > 0, `${allowed.host} has a purpose`);
  });
});
