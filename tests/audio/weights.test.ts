import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import { kokoroCommit, kokoroWeightAssetId, kokoroWeightBytes, kokoroWeightDestination, kokoroWeightFiles, kokoroWeightUrl, narrationModelsDir } from '../../src/audio/weights.ts';
import { isHostAllowed, networkAllowlist } from '../../src/net/allowlist.ts';

describe('the pinned Kokoro weights', () => {
  it('names four files of one commit, each with a byte size and a 64-hex SHA-256, 92 MB in all', () => {
    assert.equal(kokoroWeightFiles.length, 4);
    assert.match(kokoroCommit, /^[0-9a-f]{40}$/);
    for (const file of kokoroWeightFiles) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/, file.path);
      assert.ok(Number.isInteger(file.bytes) && file.bytes > 0, file.path);
      assert.ok(!file.path.includes('\\') && !file.path.startsWith('/'), file.path);
    }
    assert.equal(kokoroWeightBytes, 92_361_116 + 44 + 3_497 + 113);
  });

  it('builds resolve URLs on huggingface.co, a host the allowlist admits', () => {
    const model = kokoroWeightFiles[0]!;
    const url = new URL(kokoroWeightUrl(model));
    assert.equal(url.host, 'huggingface.co');
    assert.ok(url.pathname.includes(`/resolve/${kokoroCommit}/onnx/model_quantized.onnx`));
    assert.ok(isHostAllowed(url.host, networkAllowlist));
  });

  it('places every file under the models directory in the transformers.js local layout and ids it for the ledger', () => {
    const model = kokoroWeightFiles[0]!;
    assert.equal(kokoroWeightDestination('D:\\data', model), join('D:\\data', 'narration', 'models', 'onnx-community', 'Kokoro-82M-v1.0-ONNX', 'onnx', 'model_quantized.onnx'));
    assert.equal(narrationModelsDir('/d'), join('/d', 'narration', 'models'));
    assert.equal(kokoroWeightAssetId(model), 'narration:onnx/model_quantized.onnx');
  });
});
