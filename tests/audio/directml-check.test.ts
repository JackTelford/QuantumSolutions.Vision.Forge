import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { currentMappedLibraries, directMlLibraryName, isDirectMlMapped, mappedLibraries } from '../../src/audio/directml-check.ts';

const fakeReport = {
  header: { nodejsVersion: 'v24.13.0' },
  sharedObjects: [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\WINDOWS\\SYSTEM32\\ntdll.dll',
    '\\\\?\\C:\\data\\narration\\node_modules\\onnxruntime-node\\bin\\napi-v3\\win32\\x64\\onnxruntime.dll',
    42,
    null,
  ],
};

describe('mappedLibraries', () => {
  it('returns the string entries of sharedObjects and nothing else', () => {
    assert.deepEqual(mappedLibraries(fakeReport), fakeReport.sharedObjects.filter((entry) => typeof entry === 'string'));
  });

  it('is empty for a report without sharedObjects, a non-object or null', () => {
    assert.deepEqual(mappedLibraries({ header: {} }), []);
    assert.deepEqual(mappedLibraries({ sharedObjects: 'not a list' }), []);
    assert.deepEqual(mappedLibraries(null), []);
    assert.deepEqual(mappedLibraries('text'), []);
  });
});

describe('isDirectMlMapped', () => {
  it('is false when only onnxruntime.dll and the system libraries are mapped', () => {
    assert.equal(isDirectMlMapped(mappedLibraries(fakeReport)), false);
  });

  it('is true for DirectML.dll in any folder and any case, and false for a name that merely contains it', () => {
    assert.equal(directMlLibraryName, 'DirectML.dll');
    assert.equal(isDirectMlMapped([...mappedLibraries(fakeReport), '\\\\?\\C:\\data\\narration\\node_modules\\onnxruntime-node\\bin\\napi-v3\\win32\\x64\\DirectML.dll']), true);
    assert.equal(isDirectMlMapped(['C:\\WINDOWS\\SYSTEM32\\directml.dll']), true);
    assert.equal(isDirectMlMapped(['/usr/lib/DirectML.dll']), true);
    assert.equal(isDirectMlMapped(['C:\\x\\NotDirectML.dll', 'C:\\x\\DirectML.dll.bak']), false);
    assert.equal(isDirectMlMapped([]), false);
  });
});

describe('currentMappedLibraries', () => {
  it('reads this process, which maps the Node executable and never DirectML', () => {
    const libraries = currentMappedLibraries();
    assert.ok(Array.isArray(libraries));
    if (process.platform === 'win32') assert.ok(libraries.some((path) => path.toLowerCase().endsWith('node.exe')), libraries.join('\n'));
    assert.equal(isDirectMlMapped(libraries), false);
  });
});
