import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CancelledError, InvalidExecutableError } from '../../src/errors/vision-forge-error.ts';
import { ChildProcessRunner, assertRunnableExecutable } from '../../src/process/child-process-runner.ts';
import { stderrTail } from '../../src/process/process-runner.ts';

const node = process.execPath;
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

describe('assertRunnableExecutable', () => {
  it('rejects relative paths, shell scripts and missing files', () => {
    assert.throws(() => assertRunnableExecutable('node'), InvalidExecutableError);
    const shellShim = process.platform === 'win32' ? 'C:\\tools\\npm.cmd' : '/tmp/tools/npm.cmd';
    assert.throws(() => assertRunnableExecutable(shellShim), (error: unknown) => error instanceof InvalidExecutableError && /shell scripts/.test(error.message));
    assert.throws(() => assertRunnableExecutable(join(tmpdir(), 'does-not-exist.exe')), InvalidExecutableError);
    assert.doesNotThrow(() => assertRunnableExecutable(node));
  });
});

describe('ChildProcessRunner', () => {
  it('captures stdout, stderr and the exit code without throwing on failure', async () => {
    const result = await runner.run({ label: 'node', executable: node, args: ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'] }, never);
    assert.equal(result.exitCode, 3);
    assert.equal(result.stdout, 'out');
    assert.equal(result.stderr, 'err');
    assert.equal(result.timedOut, false);
    assert.ok(result.elapsedMs > 0);
  });

  it('passes stdin and extra environment variables', async () => {
    const result = await runner.run({
      label: 'node',
      executable: node,
      args: ['-e', 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>process.stdout.write(d + "|" + process.env.VF_TEST))'],
      stdin: new TextEncoder().encode('hello'),
      env: { VF_TEST: 'yes' },
    }, never);
    assert.equal(result.stdout, 'hello|yes');
  });

  it('mirrors output to files when asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-run-'));
    try {
      const stdoutFile = join(dir, 'out.txt');
      await runner.run({ label: 'node', executable: node, args: ['-e', 'process.stdout.write("mirrored")'], stdoutFile }, never);
      await new Promise<void>((done) => setTimeout(done, 50));
      assert.equal(readFileSync(stdoutFile, 'utf8'), 'mirrored');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kills a program that exceeds its time limit and reports timedOut', async () => {
    const result = await runner.run({ label: 'node', executable: node, args: ['-e', 'setTimeout(() => {}, 20000)'], timeoutMs: 300 }, never);
    assert.equal(result.timedOut, true);
    assert.notEqual(result.exitCode, 0);
  });

  it('rejects with CancelledError when the signal aborts', async () => {
    const controller = new AbortController();
    const pending = runner.run({ label: 'node', executable: node, args: ['-e', 'setTimeout(() => {}, 20000)'] }, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending, CancelledError);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runner.run({ label: 'node', executable: node, args: ['-e', ''] }, controller.signal), CancelledError);
  });
});

describe('stderrTail', () => {
  it('collapses whitespace and keeps the end', () => {
    assert.equal(stderrTail('a\n\n  b   c\n'), 'a b c');
    const tail = stderrTail('x'.repeat(500), 10);
    assert.equal(tail, `…${'x'.repeat(10)}`);
  });
});
