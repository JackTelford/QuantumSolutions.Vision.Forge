import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CliResult } from '../../src/cli/result.ts';
import type { SheetData } from '../../src/cli/commands/sheet.ts';
import { findFfmpeg, runFfmpeg } from '../../src/tools/ffmpeg.ts';
import { ffprobePath, makeFramePngs, never, runner } from '../qa/synthetic-clips.ts';

const ffmpeg = findFfmpeg();
const hasDrawtext = ffmpeg !== undefined && spawnSync(ffmpeg.path, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout.includes(' drawtext ');
const skipWithoutDrawtext = ffmpeg === undefined ? 'ffmpeg is not installed' : hasDrawtext ? false : 'ffmpeg has no drawtext filter';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'scripts', 'cli.ts');

interface CliRun {
  readonly exitCode: number | null;
  readonly result: CliResult;
  readonly stderr: string;
}

async function cli(args: readonly string[], dataDir: string): Promise<CliRun> {
  const result = await runner.run({ label: 'cli', executable: process.execPath, args: [cliPath, ...args, '--data-dir', dataDir, '--out', join(dataDir, 'out')], cwd: repoRoot, timeoutMs: 120_000 }, never);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout must hold exactly one JSON line, got: ${result.stdout}`);
  return { exitCode: result.exitCode, result: JSON.parse(lines[0] ?? '{}') as CliResult, stderr: result.stderr };
}

async function dimensions(path: string): Promise<readonly [number, number]> {
  const result = await runFfmpeg(runner, ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], { label: 'ffprobe' }, never);
  const [width, height] = result.stdout.trim().split(',').map(Number);
  return [width ?? 0, height ?? 0];
}

describe('sheet command', { skip: skipWithoutDrawtext }, () => {
  let dataDir = '';
  let framesDir = '';
  before(async () => {
    if (ffmpeg === undefined) return;
    dataDir = mkdtempSync(join(tmpdir(), 'vf-cli-sheet-'));
    framesDir = join(dataDir, 'shot01');
    mkdirSync(framesDir);
    await makeFramePngs(framesDir, 6);
  });
  after(() => { if (dataDir.length > 0) rmSync(dataDir, { recursive: true, force: true }); });

  it('tiles a directory of PNGs into <out>/sheets/<dir name>.png with 4 columns', async () => {
    const run = await cli(['sheet', '--frames', framesDir], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as SheetData;
    assert.deepEqual([data.count, data.columns, data.rows], [6, 4, 2]);
    assert.equal(data.outputPath, join(dataDir, 'out', 'sheets', 'shot01.png'));
    assert.deepEqual(run.result.artifacts, [data.outputPath]);
    assert.ok(existsSync(data.outputPath));
    assert.deepEqual(await dimensions(data.outputPath), [1962, 570]);
  });

  it('takes a JSON list, --output, --columns and --thumb-width', async () => {
    const listPath = join(dataDir, 'list.json');
    writeFileSync(listPath, JSON.stringify([1, 2, 3].map((n) => ({ path: `shot01/f${n}.png`, label: `shot 01 frame ${n}` }))), 'utf8');
    const output = join(dataDir, 'custom.png');
    const run = await cli(['sheet', '--frames', listPath, '--output', output, '--columns', '3', '--thumb-width', '320'], dataDir);
    assert.equal(run.exitCode, 0, run.stderr);
    const data = run.result.data as SheetData;
    assert.deepEqual([data.count, data.columns, data.rows, data.outputPath], [3, 3, 1, output]);
    assert.deepEqual(await dimensions(output), [3 * 320 + 2 * 6 + 24, 180 + 24]);
  });

  it('refuses to run without --frames and rejects a bad column count', async () => {
    const missing = await cli(['sheet'], dataDir);
    assert.equal(missing.exitCode, 2);
    assert.match(missing.result.errors[0]?.message ?? '', /Missing --frames/);
    const bad = await cli(['sheet', '--frames', framesDir, '--columns', '0'], dataDir);
    assert.equal(bad.exitCode, 2);
    assert.match(bad.result.errors[0]?.message ?? '', /--columns must be a whole number/);
  });
});
