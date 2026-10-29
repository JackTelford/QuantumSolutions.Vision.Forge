import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { UsageError, VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import { buildContactSheet, contactSheetArgs, contactSheetGraph, escapeDrawtextLabel, findSheetFont, resolveSheetRequest, sheetRows } from '../../src/sheet/contact-sheet.ts';
import { filterPath, findFfmpeg, runFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { ffmpegPath, ffprobePath, makeFramePngs, never, runner } from '../qa/synthetic-clips.ts';

const ffmpeg = findFfmpeg();
const hasDrawtext = ffmpeg !== undefined && spawnSync(ffmpeg.path, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout.includes(' drawtext ');
const skipWithoutDrawtext = ffmpeg === undefined ? 'ffmpeg is not installed' : hasDrawtext ? false : 'ffmpeg has no drawtext filter';

describe('drawtext label escaping', () => {
  it('backslash-escapes a space twice so the parsers keep it', () => {
    assert.equal(escapeDrawtextLabel('plain label'), 'plain\\\\\\ label');
  });

  it('protects apostrophes, colons, commas, semicolons, brackets and equals from both parsers', () => {
    assert.equal(escapeDrawtextLabel("it's"), "it\\\\\\'s");
    assert.equal(escapeDrawtextLabel('a:b'), 'a\\\\\\:b');
    assert.equal(escapeDrawtextLabel('a,b;c'), 'a\\\\\\,b\\\\\\;c');
    assert.equal(escapeDrawtextLabel('[d]=e'), '\\\\\\[d\\\\\\]\\\\\\=e');
  });

  it('escapes a percent for drawtext expansion and a backslash at every level', () => {
    assert.equal(escapeDrawtextLabel('50%'), '50\\\\\\\\%');
    assert.equal(escapeDrawtextLabel('a\\b'), 'a\\\\\\\\\\\\\\\\b');
    assert.equal(escapeDrawtextLabel(''), '');
    assert.equal(escapeDrawtextLabel('f000010'), 'f000010');
  });
});

describe('sheet layout and request', () => {
  it('finds the platform font when it exists and nothing otherwise', () => {
    const env = { WINDIR: 'D:\\Win' };
    assert.equal(findSheetFont('win32', env, (path) => path === 'D:\\Win\\Fonts\\segoeui.ttf'), 'D:\\Win\\Fonts\\segoeui.ttf');
    assert.equal(findSheetFont('win32', {}, (path) => path === 'C:\\Windows\\Fonts\\segoeui.ttf'), 'C:\\Windows\\Fonts\\segoeui.ttf');
    assert.equal(findSheetFont('darwin', {}, (path) => path.endsWith('Helvetica.ttc')), '/System/Library/Fonts/Helvetica.ttc');
    assert.equal(findSheetFont('darwin', {}, () => true), '/System/Library/Fonts/Supplemental/Arial.ttf');
    assert.equal(findSheetFont('linux', {}, (path) => path.includes('dejavu')), '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
    assert.equal(findSheetFont('linux', {}, () => false), undefined);
  });

  it('computes rows from the count and the columns', () => {
    assert.equal(sheetRows(6, 4), 2);
    assert.equal(sheetRows(8, 4), 2);
    assert.equal(sheetRows(9, 4), 3);
    assert.equal(sheetRows(1, 4), 1);
  });

  it('fills the defaults and refuses empty or malformed requests', () => {
    const resolved = resolveSheetRequest({ frames: [{ path: 'a.png', label: 'a' }], output: 'sheet.png' }, () => undefined);
    assert.deepEqual([resolved.columns, resolved.thumbWidth, resolved.padding, resolved.margin, resolved.background, resolved.rows, resolved.fontFile], [4, 480, 6, 12, '#202020', 1, undefined]);
    assert.equal(resolveSheetRequest({ frames: [{ path: 'a.png', label: 'a' }], output: 'sheet.png' }, () => 'C:\\f.ttf').fontFile, 'C:\\f.ttf');
    assert.equal(resolveSheetRequest({ frames: [{ path: 'a.png', label: 'a' }], output: 'sheet.png', fontFile: 'D:\\g.ttf' }, () => 'C:\\f.ttf').fontFile, 'D:\\g.ttf');
    assert.throws(() => resolveSheetRequest({ frames: [], output: 'sheet.png' }), (error: unknown) => error instanceof VisionForgeError && error.code === 'sheet-no-frames');
    assert.throws(() => resolveSheetRequest({ frames: [{ path: 'a.png', label: 'a' }], output: 'x', columns: 0 }), UsageError);
    assert.throws(() => resolveSheetRequest({ frames: [{ path: 'a.png', label: 'a' }], output: 'x', thumbWidth: 1.5 }), UsageError);
    assert.throws(() => resolveSheetRequest({ frames: [{ path: 'a.png', label: 'a' }], output: 'x', background: 'gray' }), UsageError);
  });

  it('builds one scale and drawtext chain per input, then concat and tile', () => {
    const request = { frames: [{ path: 'C:\\f\\a.png', label: 'a' }, { path: 'C:\\f\\b.png', label: 'b c' }], columns: 2, thumbWidth: 320, fontFile: 'C:\\Windows\\Fonts\\segoeui.ttf', output: 'C:\\f\\sheet.png' };
    const graph = contactSheetGraph(request);
    assert.equal(graph, [
      "[0:v]scale=320:-2,setsar=1,drawtext=text=a:x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=0x00000088:fontfile='C\\:/Windows/Fonts/segoeui.ttf'[t0]",
      "[1:v]scale=320:-2,setsar=1,drawtext=text=b\\\\\\ c:x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=0x00000088:fontfile='C\\:/Windows/Fonts/segoeui.ttf'[t1]",
      '[t0][t1]concat=n=2:v=1:a=0,tile=2x1:padding=6:margin=12:color=0x202020',
    ].join(';'));
    assert.deepEqual(contactSheetArgs(request), ['-y', '-i', 'C:\\f\\a.png', '-i', 'C:\\f\\b.png', '-filter_complex', graph, '-frames:v', '1', 'C:\\f\\sheet.png']);
    const { fontFile: _fontFile, ...withoutFont } = request;
    assert.doesNotMatch(contactSheetGraph(withoutFont, () => undefined), /fontfile/);
    assert.match(contactSheetGraph(withoutFont, () => 'C:\\Fonts\\x.ttf'), /fontfile='C\\:\/Fonts\/x\.ttf'/);
  });

  it('runs ffmpeg once with the arguments and reports the layout', async () => {
    const fake = new FakeProcessRunner();
    fake.expect(matchProgram('ffmpeg.exe'), okResult());
    const dir = mkdtempSync(join(tmpdir(), 'vf-sheet-fake-'));
    try {
      const output = join(dir, 'deep', 'sheet.png');
      const result = await buildContactSheet(fake, 'C:\\tools\\ffmpeg.exe', { frames: [{ path: 'a.png', label: 'a' }, { path: 'b.png', label: 'b' }, { path: 'c.png', label: 'c' }], columns: 2, output }, never);
      assert.deepEqual(result, { outputPath: output, count: 3, columns: 2, rows: 2 });
      assert.equal(fake.invocations.length, 1);
      assert.equal(fake.invocations[0]?.args[0], '-hide_banner');
      assert.ok(existsSync(join(dir, 'deep')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('contact sheet from six PNGs', { skip: skipWithoutDrawtext }, () => {
  let dir = '';
  let frames: { readonly path: string; readonly label: string }[] = [];
  before(async () => {
    if (ffmpeg === undefined) return;
    dir = mkdtempSync(join(tmpdir(), 'vf-sheet-'));
    frames = (await makeFramePngs(dir, 6)).map((path, index) => ({ path, label: `shot 01 f${index + 1}` }));
  });
  after(() => { if (dir.length > 0) rmSync(dir, { recursive: true, force: true }); });

  async function dimensions(path: string): Promise<readonly [number, number]> {
    const result = await runFfmpeg(runner, ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], { label: 'ffprobe' }, never);
    const [width, height] = result.stdout.trim().split(',').map(Number);
    return [width ?? 0, height ?? 0];
  }

  it('lays 6 frames out as 4 columns and 2 rows with padding and margins, with the platform font', async () => {
    const fontFile = findSheetFont();
    const output = join(dir, 'sheet-font.png');
    const result = await buildContactSheet(runner, ffmpegPath(), { frames, output, ...(fontFile === undefined ? {} : { fontFile }) }, never);
    assert.deepEqual([result.count, result.columns, result.rows], [6, 4, 2]);
    assert.deepEqual(await dimensions(output), [4 * 480 + 3 * 6 + 2 * 12, 2 * 270 + 1 * 6 + 2 * 12]);
  });

  it('finds the platform font itself when the request names none and renders the same layout', async () => {
    const output = join(dir, 'sheet-nofont.png');
    if (findSheetFont() !== undefined) assert.match(contactSheetGraph({ frames, output }), /fontfile=/);
    await buildContactSheet(runner, ffmpegPath(), { frames, output }, never);
    assert.deepEqual(await dimensions(output), [1962, 570]);
  });

  it('honours columns and thumbnail width', async () => {
    const output = join(dir, 'sheet-3.png');
    const result = await buildContactSheet(runner, ffmpegPath(), { frames, output, columns: 3, thumbWidth: 320 }, never);
    assert.deepEqual([result.columns, result.rows], [3, 2]);
    assert.deepEqual(await dimensions(output), [3 * 320 + 2 * 6 + 24, 2 * 180 + 6 + 24]);
  });

  it('an escaped label renders the same pixels as the raw text read from a file', async () => {
    const label = "it's 50%: a,b;c [d] \\ e=f";
    const textFile = join(dir, 'label.txt');
    writeFileSync(textFile, label, 'utf8');
    const fontFile = findSheetFont();
    const font = fontFile === undefined ? '' : `:fontfile=${filterPath(fontFile)}`;
    const source = ['-f', 'lavfi', '-i', 'color=c=0x404040:size=480x120:rate=1:duration=1'];
    const hashOf = async (filter: string): Promise<string> => {
      const result = await runFfmpeg(runner, ffmpegPath(), [...source, '-vf', filter, '-frames:v', '1', '-f', 'framehash', '-hash', 'sha256', '-'], { label: 'ffmpeg' }, never);
      return result.stdout.split(/\r?\n/).find((line) => line.startsWith('0,')) ?? '';
    };
    const viaText = await hashOf(`drawtext=text=${escapeDrawtextLabel(label)}:x=8:y=8:fontsize=22:fontcolor=white${font}`);
    const viaFile = await hashOf(`drawtext=textfile=${filterPath(textFile)}:expansion=none:x=8:y=8:fontsize=22:fontcolor=white${font}`);
    const blank = await hashOf(`drawtext=text=:x=8:y=8:fontsize=22:fontcolor=white${font}`);
    assert.ok(viaText.length > 0);
    assert.equal(viaText, viaFile);
    assert.notEqual(viaText, blank);
  });
});
