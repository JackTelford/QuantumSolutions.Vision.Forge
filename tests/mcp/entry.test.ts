import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LineReader } from './line-reader.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = join(repoRoot, 'scripts', 'mcp.ts');

interface Spawned {
  readonly child: ChildProcess;
  readonly stdout: LineReader;
  readonly stderr: () => string;
  readonly exited: Promise<number | null>;
  readonly send: (message: unknown) => void;
}

function exitOf(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise<number | null>((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(new Error(`The server did not exit within ${timeoutMs} ms after stdin ended.`)); }, timeoutMs);
    child.once('exit', (code) => { clearTimeout(timer); done(code); });
  });
}

function start(dataDir: string): Spawned {
  const child = spawn(process.execPath, [entry, '--data-dir', dataDir, '--out', join(dataDir, 'out')], { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  const stdout = new LineReader();
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout.feed(chunk); });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  return {
    child,
    stdout,
    stderr: (): string => stderr,
    exited: exitOf(child, 60_000),
    send: (message: unknown): void => { child.stdin?.write(`${JSON.stringify(message)}\n`); },
  };
}

describe('scripts/mcp.ts over stdio', () => {
  let dataDir = '';
  before(() => { dataDir = mkdtempSync(join(tmpdir(), 'vf-mcp-')); });
  after(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('answers initialize, ping and tools/list as JSON lines on stdout and exits 0 when stdin ends', async () => {
    const { child, stdout, stderr, exited, send } = start(dataDir);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0' } } });
    const init = await stdout.response(1);
    assert.equal(init.error, undefined, JSON.stringify(init.error));
    const initResult = init.result as { protocolVersion: string; serverInfo: { name: string; version: string }; instructions: string };
    assert.equal(initResult.protocolVersion, '2025-06-18');
    assert.equal(initResult.serverInfo.name, 'vision-forge');
    assert.match(initResult.serverInfo.version, /^\d+\.\d+\.\d+/);
    assert.equal(typeof initResult.instructions, 'string');

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    assert.deepEqual((await stdout.response(2)).result, {});
    const tools = (await stdout.response(3)).result as { tools: readonly unknown[] };
    assert.ok(Array.isArray(tools.tools));

    assert.deepEqual(stdout.messages().map((message) => message.id), [1, 2, 3], 'stdout carried the three responses and nothing else');
    assert.match(stderr(), /vision-forge mcp/);

    const closedAt = Date.now();
    child.stdin?.end();
    const code = await exited;
    assert.equal(code, 0, `exit code ${String(code)}; stderr: ${stderr()}`);
    assert.ok(Date.now() - closedAt < 5000, 'the server exits within a few seconds of stdin ending');
  });

  it('refuses a positional argument as a usage error on stderr with exit code 2 and nothing on stdout', async () => {
    const child = spawn(process.execPath, [entry, 'render'], { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    const code = await exitOf(child, 60_000);
    assert.equal(code, 2, stderr);
    assert.equal(stdout, '');
    assert.match(stderr, /Unexpected argument "render"/);
    assert.doesNotMatch(stderr, /\n\s+at /, 'no stack trace');
  });
});
