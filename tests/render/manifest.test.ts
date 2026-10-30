import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { SchemaValidationError } from '../../src/errors/vision-forge-error.ts';
import { writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { addFrames, complete, fail, fingerprintHash, hasEveryFrame, hashedFrames, isComplete, missingFrames, newManifest, readManifest, writeManifest } from '../../src/render/manifest.ts';
import { validateDocument } from '../../src/schema/validator.ts';
import { contentHash } from '../../src/shared/sha256.ts';
import { hex64 } from '../schema/documents/examples.ts';
import { fingerprintExample, manifestInputs } from './fixtures.ts';

describe('render manifest', () => {
  it('starts rendering with no frames and a toolVersionsHash that is the fingerprint\'s content hash', async () => {
    const manifest = await newManifest(manifestInputs());
    validateDocument('render-manifest', manifest);
    assert.equal(manifest.status, 'rendering');
    assert.deepEqual(manifest.frames, []);
    assert.equal(manifest.frameCount, 5);
    assert.equal(manifest.toolVersionsHash, await contentHash(fingerprintExample));
    assert.equal(await fingerprintHash(fingerprintExample), manifest.toolVersionsHash);
    assert.equal(manifest.finishedAt, undefined);
  });

  it('adds frames in index order, replacing a frame hashed twice', async () => {
    const manifest = addFrames(await newManifest(manifestInputs()), [{ index: 3, sha256: hex64('3') }, { index: 1, sha256: hex64('1') }]);
    const again = addFrames(manifest, [{ index: 1, sha256: hex64('f') }, { index: 0, sha256: hex64('0') }]);
    assert.deepEqual(again.frames.map((frame) => [frame.index, frame.sha256[0]]), [[0, '0'], [1, 'f'], [3, '3']]);
    assert.deepEqual([...hashedFrames(again)].sort(), [0, 1, 3]);
    assert.deepEqual(missingFrames(again, [0, 1, 2, 3, 4]), [2, 4]);
    assert.equal(hasEveryFrame(again), false);
  });

  it('is complete only when the status says so and every frame of the count is hashed', async () => {
    let manifest = await newManifest(manifestInputs());
    manifest = addFrames(manifest, [0, 1, 2, 3, 4].map((index) => ({ index, sha256: hex64(String(index)) })));
    assert.equal(hasEveryFrame(manifest), true);
    assert.equal(isComplete(manifest, 5), false);
    const done = complete(manifest, '2026-10-29T10:01:00.000Z');
    assert.equal(done.status, 'complete');
    assert.equal(done.finishedAt, '2026-10-29T10:01:00.000Z');
    assert.equal(isComplete(done, 5), true);
    assert.equal(isComplete(done, 6), false);
    assert.equal(isComplete(complete(addFrames(await newManifest(manifestInputs()), [{ index: 0, sha256: hex64('0') }]), '2026-10-29T10:01:00.000Z'), 5), false);
    const failed = fail(manifest, '2026-10-29T10:02:00.000Z');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.frames.length, 5);
  });

  it('does not share its arrays with the inputs', async () => {
    const entries = [{ index: 0, sha256: hex64('0') }];
    const manifest = addFrames(await newManifest(manifestInputs()), entries);
    entries.push({ index: 1, sha256: hex64('1') });
    assert.equal(manifest.frames.length, 1);
  });
});

describe('manifest files', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-manifest-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('round-trips through disk and validates on both sides', async () => {
    const path = join(dir, 'manifest.json');
    const manifest = complete(addFrames(await newManifest(manifestInputs()), [{ index: 0, sha256: hex64('0') }]), '2026-10-29T10:01:00.000Z');
    writeManifest(path, manifest);
    assert.deepEqual(readManifest(path), manifest);
  });

  it('refuses to write a manifest the schema rejects and to read one', async () => {
    const path = join(dir, 'bad.json');
    const manifest = await newManifest(manifestInputs({ key: 'not-a-key' }));
    assert.throws(() => writeManifest(path, manifest), (error: unknown) => error instanceof SchemaValidationError && /\/key/.test(error.message));
    writeJsonAtomic(path, { ...manifest, status: 'done' });
    assert.throws(() => readManifest(path), (error: unknown) => error instanceof SchemaValidationError && /\/status/.test(error.message));
  });
});

describe('render manifest plates', () => {
  it('records the plate when the inputs name one and leaves it out for a picture, so older manifests read unchanged', async () => {
    const picture = await newManifest(manifestInputs());
    assert.equal('plate' in picture, false);
    const text = await newManifest(manifestInputs({ lane: 'html', plate: 'text' }));
    validateDocument('render-manifest', text);
    assert.equal(text.plate, 'text');
    assert.equal(text.lane, 'html');
  });
});
