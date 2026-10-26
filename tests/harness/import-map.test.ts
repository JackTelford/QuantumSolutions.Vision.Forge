import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importMapJson, importMapScriptTag } from '../../src/harness/import-map.ts';

const expected = {
  imports: {
    three: '/vendor/three/build/three.module.js',
    'three/addons/': '/vendor/three/examples/jsm/',
  },
};

describe('importMapJson', () => {
  it('maps three and the addons prefix to the served vendor root, and nothing else', () => {
    assert.deepEqual(JSON.parse(importMapJson()), expected);
  });
});

describe('importMapScriptTag', () => {
  it('wraps the same JSON in an importmap script tag', () => {
    const open = '<script type="importmap">';
    const close = '</script>';
    const tag = importMapScriptTag();
    assert.ok(tag.startsWith(open));
    assert.ok(tag.endsWith(close));
    assert.deepEqual(JSON.parse(tag.slice(open.length, tag.length - close.length)), expected);
  });
});
