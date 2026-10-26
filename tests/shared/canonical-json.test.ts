import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalJson } from '../../src/shared/canonical-json.ts';
import { contentHash, sha256Hex, shortHash, toHex } from '../../src/shared/sha256.ts';

describe('canonicalJson', () => {
  it('sorts object keys at every level and removes whitespace', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('omits undefined properties and keeps null', () => {
    assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
  });

  it('treats undefined array items as null', () => {
    assert.equal(canonicalJson([1, undefined, 2]), '[1,null,2]');
  });

  it('rejects values JSON cannot represent instead of silently changing them', () => {
    assert.throws(() => canonicalJson({ n: Number.NaN }), /non-finite number at \$\.n/);
    assert.throws(() => canonicalJson({ f: () => 1 }), /type function at \$\.f/);
    assert.throws(() => canonicalJson(10n), /type bigint/);
  });

  it('gives the same text for equal content regardless of key order', () => {
    assert.equal(canonicalJson({ x: 1, y: [{ b: 2, a: 1 }] }), canonicalJson({ y: [{ a: 1, b: 2 }], x: 1 }));
  });
});

describe('sha256', () => {
  it('matches the well-known digest of "abc"', async () => {
    assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes bytes the same as the equivalent string', async () => {
    assert.equal(await sha256Hex(new TextEncoder().encode('abc')), await sha256Hex('abc'));
  });

  it('contentHash is order-independent and shortHash takes a prefix', async () => {
    const a = await contentHash({ x: 1, y: 2 });
    const b = await contentHash({ y: 2, x: 1 });
    assert.equal(a, b);
    assert.equal(a.length, 64);
    assert.equal(shortHash(a), a.slice(0, 12));
  });

  it('toHex pads single digits', () => {
    assert.equal(toHex(new Uint8Array([0, 15, 255])), '000fff');
  });
});
