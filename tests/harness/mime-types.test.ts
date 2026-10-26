import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentTypeFor, fallbackContentType, javascriptContentType } from '../../src/harness/mime-types.ts';

describe('contentTypeFor', () => {
  it('serves TypeScript and JavaScript alike as text/javascript', () => {
    assert.equal(contentTypeFor('.ts'), javascriptContentType);
    assert.equal(contentTypeFor('.js'), javascriptContentType);
    assert.equal(contentTypeFor('.mjs'), javascriptContentType);
    assert.equal(javascriptContentType, 'text/javascript; charset=utf-8');
  });

  it('knows the page, font, image and model types the lanes use', () => {
    assert.equal(contentTypeFor('.html'), 'text/html; charset=utf-8');
    assert.equal(contentTypeFor('.css'), 'text/css; charset=utf-8');
    assert.equal(contentTypeFor('.json'), 'application/json; charset=utf-8');
    assert.equal(contentTypeFor('.png'), 'image/png');
    assert.equal(contentTypeFor('.jpg'), 'image/jpeg');
    assert.equal(contentTypeFor('.svg'), 'image/svg+xml');
    assert.equal(contentTypeFor('.ttf'), 'font/ttf');
    assert.equal(contentTypeFor('.otf'), 'font/otf');
    assert.equal(contentTypeFor('.woff2'), 'font/woff2');
    assert.equal(contentTypeFor('.hdr'), 'application/octet-stream');
    assert.equal(contentTypeFor('.glb'), 'model/gltf-binary');
    assert.equal(contentTypeFor('.wasm'), 'application/wasm');
  });

  it('ignores case and falls back to raw bytes for unknown extensions', () => {
    assert.equal(contentTypeFor('.PNG'), 'image/png');
    assert.equal(contentTypeFor('.unknown'), fallbackContentType);
    assert.equal(contentTypeFor(''), fallbackContentType);
  });
});
