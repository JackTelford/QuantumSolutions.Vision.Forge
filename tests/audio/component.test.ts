import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { componentPaths, componentStatus, narrationPackages, narrationTemplateDir, packageJsonPath, sha256OfBytes } from '../../src/audio/component.ts';
import { kokoroWeightDestination, kokoroWeightFiles, narrationDir, narrationModelsDir } from '../../src/audio/weights.ts';
import type { PinnedWeightFile } from '../../src/audio/weights.ts';

/** Small stand-ins for the pinned files: the status checks sizes, so the bytes are arbitrary. */
const smallFiles: readonly PinnedWeightFile[] = [
  { path: 'onnx/model_quantized.onnx', bytes: 1024, sha256: '0'.repeat(64) },
  { path: 'config.json', bytes: 44, sha256: '1'.repeat(64) },
];

function touch(path: string, text: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** What a finished `npm ci` leaves behind that the status reads: the two package.json markers and npm's hidden lockfile. */
function fakeFinishedNpm(dataDir: string): void {
  for (const name of narrationPackages) touch(packageJsonPath(dataDir, name), '{}');
  touch(componentPaths(dataDir).hiddenLockfile, '{ "lockfileVersion": 3 }\n');
}

describe('componentPaths', () => {
  it('places everything under <data>/narration with the model folder in the transformers.js layout', () => {
    const paths = componentPaths('D:\\vf');
    assert.equal(paths.root, narrationDir('D:\\vf'));
    assert.equal(paths.nodeModules, join(paths.root, 'node_modules'));
    assert.equal(paths.hiddenLockfile, join(paths.nodeModules, '.package-lock.json'));
    assert.equal(paths.lockfile, join(paths.root, 'package-lock.json'));
    assert.equal(paths.models, narrationModelsDir('D:\\vf'));
    assert.equal(paths.modelDir, join(paths.models, 'onnx-community', 'Kokoro-82M-v1.0-ONNX'));
    assert.equal(paths.license, join(paths.modelDir, 'LICENSE.txt'));
    assert.equal(paths.provenance, join(paths.root, 'provenance.json'));
    assert.equal(packageJsonPath('D:\\vf', '@huggingface/transformers'), join(paths.nodeModules, '@huggingface', 'transformers', 'package.json'));
    assert.deepEqual(narrationPackages, ['kokoro-js', '@huggingface/transformers']);
  });

  it('finds the template beside the repository\'s components folder', () => {
    assert.ok(narrationTemplateDir.endsWith(join('components', 'narration')), narrationTemplateDir);
  });
});

describe('componentStatus', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-component-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reports an absent component with one sentence per missing thing', () => {
    const dataDir = join(dir, 'absent');
    mkdirSync(dataDir, { recursive: true });
    const status = componentStatus(dataDir, smallFiles);
    assert.equal(status.installed, false);
    assert.equal(status.packagesPresent, false);
    assert.equal(status.lockfileHash, null);
    assert.equal(status.lockfileMatches, false);
    assert.deepEqual(status.weightsPresent.map((weight) => [weight.path, weight.bytes, weight.bytesMatched]), [['onnx/model_quantized.onnx', null, false], ['config.json', null, false]]);
    assert.equal(status.missing.length, 4, status.missing.join('\n'));
    assert.match(status.missing[0] ?? '', /packages kokoro-js, @huggingface\/transformers are not under/);
    assert.match(status.missing[1] ?? '', /package-lock\.json does not exist/);
    assert.match(status.missing[2] ?? '', /model file onnx\/model_quantized\.onnx is not under/);
  });

  it('reports packages present once both package.json files, npm\'s hidden lockfile and the template lockfile are there, with the weights still wanting', () => {
    const dataDir = join(dir, 'packages');
    const paths = componentPaths(dataDir);
    fakeFinishedNpm(dataDir);
    mkdirSync(paths.root, { recursive: true });
    copyFileSync(join(narrationTemplateDir, 'package-lock.json'), paths.lockfile);
    const status = componentStatus(dataDir, smallFiles);
    assert.equal(status.packagesPresent, true);
    assert.equal(status.lockfileMatches, true);
    assert.match(status.lockfileHash ?? '', /^[0-9a-f]{64}$/);
    assert.equal(status.installed, false);
    assert.deepEqual(status.missing.map((sentence) => sentence.split(' is not under')[0]), ['the model file onnx/model_quantized.onnx', 'the model file config.json']);
  });

  it('counts the packages as absent when the two package.json markers stand without npm\'s hidden lockfile, as after a killed npm ci', () => {
    const dataDir = join(dir, 'killed-npm');
    const paths = componentPaths(dataDir);
    for (const name of narrationPackages) touch(packageJsonPath(dataDir, name), '{}');
    mkdirSync(paths.root, { recursive: true });
    copyFileSync(join(narrationTemplateDir, 'package-lock.json'), paths.lockfile);
    for (const file of smallFiles) touch(kokoroWeightDestination(dataDir, file), Buffer.alloc(file.bytes, 1));
    const status = componentStatus(dataDir, smallFiles);
    assert.equal(status.packagesPresent, false);
    assert.equal(status.installed, false);
    assert.deepEqual(status.missing, [`${paths.hiddenLockfile} does not exist, so the last npm ci did not finish`]);
  });

  it('is installed when every pinned file exists at its exact size, and names a file of the wrong size', () => {
    const dataDir = join(dir, 'complete');
    const paths = componentPaths(dataDir);
    fakeFinishedNpm(dataDir);
    mkdirSync(paths.root, { recursive: true });
    copyFileSync(join(narrationTemplateDir, 'package-lock.json'), paths.lockfile);
    for (const file of smallFiles) touch(kokoroWeightDestination(dataDir, file), Buffer.alloc(file.bytes, 1));
    const status = componentStatus(dataDir, smallFiles);
    assert.equal(status.installed, true, status.missing.join('\n'));
    assert.deepEqual(status.missing, []);
    assert.ok(status.weightsPresent.every((weight) => weight.bytesMatched && weight.bytes === weight.expectedBytes));

    touch(kokoroWeightDestination(dataDir, smallFiles[1]!), Buffer.alloc(43, 1));
    const short = componentStatus(dataDir, smallFiles);
    assert.equal(short.installed, false);
    assert.deepEqual(short.missing, ['the model file config.json is 43 bytes, not the pinned 44']);
  });

  it('is not installed when the copied lockfile differs from the template, even with everything else in place', () => {
    const dataDir = join(dir, 'stale-lockfile');
    const paths = componentPaths(dataDir);
    fakeFinishedNpm(dataDir);
    touch(paths.lockfile, '{ "lockfileVersion": 3, "packages": {} }\n');
    for (const file of smallFiles) touch(kokoroWeightDestination(dataDir, file), Buffer.alloc(file.bytes, 1));
    const status = componentStatus(dataDir, smallFiles);
    assert.equal(status.packagesPresent, true);
    assert.equal(status.lockfileMatches, false);
    assert.equal(status.lockfileHash, sha256OfBytes(Buffer.from('{ "lockfileVersion": 3, "packages": {} }\n')));
    assert.equal(status.installed, false);
    assert.match(status.missing[0] ?? '', /differs from the template/);
  });

  it('checks the real pinned manifest by default: four weights', () => {
    const status = componentStatus(join(dir, 'absent'));
    assert.equal(status.weightsPresent.length, kokoroWeightFiles.length);
    assert.equal(status.weightsPresent[0]?.expectedBytes, 92_361_116);
  });
});
