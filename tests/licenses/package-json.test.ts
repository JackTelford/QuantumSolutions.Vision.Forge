import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { declaredLicense, normalizeRepositoryUrl, repositoryUrl } from '../../src/licenses/package-json.ts';

describe('declaredLicense', () => {
  it('reads the license string', () => {
    assert.equal(declaredLicense({ license: ' MIT ' }), 'MIT');
  });

  it('reads the legacy {type} object', () => {
    assert.equal(declaredLicense({ license: { type: 'ISC', url: 'https://opensource.org/licenses/ISC' } }), 'ISC');
  });

  it('joins a legacy licenses array with OR, as npm documents the choice', () => {
    assert.equal(declaredLicense({ licenses: [{ type: 'MIT' }, 'Apache-2.0'] }), '(MIT OR Apache-2.0)');
    assert.equal(declaredLicense({ licenses: [{ type: 'ISC' }] }), 'ISC');
  });

  it('returns undefined when nothing usable is declared', () => {
    assert.equal(declaredLicense({}), undefined);
    assert.equal(declaredLicense({ license: '' }), undefined);
    assert.equal(declaredLicense({ license: { url: 'https://example.com' } }), undefined);
    assert.equal(declaredLicense({ licenses: [] }), undefined);
  });
});

describe('normalizeRepositoryUrl', () => {
  it('collapses every git spelling to https without a .git suffix', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['git+https://github.com/epoberezkin/fast-deep-equal.git', 'https://github.com/epoberezkin/fast-deep-equal'],
      ['git://github.com/minimistjs/minimist.git', 'https://github.com/minimistjs/minimist'],
      ['git@github.com:example/copyleft.git', 'https://github.com/example/copyleft'],
      ['git+ssh://git@github.com/example/repo.git', 'https://github.com/example/repo'],
      ['git+ssh://git@github.com:user/repo.git', 'https://github.com/user/repo'],
      ['ssh://git@gitlab.com:22/example/repo.git', 'https://gitlab.com/example/repo'],
      ['https://github.com/mrdoob/three.js', 'https://github.com/mrdoob/three.js'],
      ['https://github.com/example/repo/', 'https://github.com/example/repo'],
      ['https://github.com/example/repo.git#main', 'https://github.com/example/repo'],
    ];
    for (const [raw, expected] of cases) assert.equal(normalizeRepositoryUrl(raw), expected, raw);
  });

  it('expands npm shorthand', () => {
    assert.equal(normalizeRepositoryUrl('nodeca/argparse'), 'https://github.com/nodeca/argparse');
    assert.equal(normalizeRepositoryUrl('github:example/legacy'), 'https://github.com/example/legacy');
    assert.equal(normalizeRepositoryUrl('gitlab:example/repo'), 'https://gitlab.com/example/repo');
    assert.equal(normalizeRepositoryUrl('bitbucket:example/repo'), 'https://bitbucket.org/example/repo');
  });

  it('returns undefined for text that is not a repository location', () => {
    for (const text of ['not a url', 'gist:abc123', 'file:../local', '']) assert.equal(normalizeRepositoryUrl(text), undefined, text);
  });
});

describe('repositoryUrl', () => {
  it('reads the string form and the {url} object form', () => {
    assert.equal(repositoryUrl({ repository: 'scope/alpha' }), 'https://github.com/scope/alpha');
    assert.equal(repositoryUrl({ repository: { type: 'git', url: 'git+https://github.com/example/beta.git', directory: 'packages/beta' } }), 'https://github.com/example/beta');
  });

  it('returns undefined when the field is absent or has no url', () => {
    assert.equal(repositoryUrl({}), undefined);
    assert.equal(repositoryUrl({ repository: { type: 'git' } }), undefined);
  });
});
