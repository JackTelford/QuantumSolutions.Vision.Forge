import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeProcessRunner, failedResult, matchProgram, okResult } from '../fakes/fake-process-runner.ts';

const never = new AbortController().signal;

describe('FakeProcessRunner', () => {
  it('returns canned results in order and records invocations', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe', ['-version']), okResult('ffmpeg version 9'));
    fake.expect(matchProgram('ffmpeg.exe'), failedResult(1, 'bad'));
    const first = await fake.run({ label: 'ffmpeg', executable: 'C:\\tools\\ffmpeg.exe', args: ['-version'] }, never);
    const second = await fake.run({ label: 'ffmpeg', executable: 'C:\\tools\\FFMPEG.EXE', args: ['-i', 'x'] }, never);
    assert.equal(first.stdout, 'ffmpeg version 9');
    assert.equal(second.exitCode, 1);
    assert.equal(fake.invocations.length, 2);
    fake.assertAllUsed();
  });

  it('throws on an unexpected program and on unused expectations', async () => {
    const fake = new FakeProcessRunner();
    await assert.rejects(fake.run({ label: 'blender', executable: '/b/blender', args: [] }, never), /Unexpected process run: \/b\/blender/);
    fake.expect(matchProgram('blender'), okResult());
    assert.throws(() => fake.assertAllUsed(), /1 expected process run/);
  });

  it('runs the side effect so tests can create the files a program would write', async () => {
    const fake = new FakeProcessRunner();
    let written = '';
    fake.expect(matchProgram('blender.exe'), okResult(), (spec) => { written = spec.args.join(' '); });
    await fake.run({ label: 'blender', executable: 'C:\\b\\blender.exe', args: ['-b', 'scene'] }, never);
    assert.equal(written, '-b scene');
  });
});
