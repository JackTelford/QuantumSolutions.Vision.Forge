import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import { openBrowserRenderer } from '../../src/harness/browser-session.ts';
import { HarnessServer } from '../../src/harness/harness-server.ts';
import { renderServedRoots, repositoryRoot } from '../../src/harness/served-roots.ts';
import type { BrowserRenderer } from '../../src/harness/types.ts';
import { pageUrl, writeShotPage } from '../../src/lanes/html/page.ts';
import { buildShotPageSpec } from '../../src/render/shot-page-spec.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import { findFfmpeg, findFfprobe } from '../../src/tools/ffmpeg.ts';
import { testBrowser } from '../fakes/test-browser.ts';
import { planLook, planShotSpec } from '../plan/fixtures.ts';
import { mutated } from '../schema/documents/examples.ts';

const browser = testBrowser();
const ffmpeg = findFfmpeg()?.path;
const ffprobe = findFfprobe(ffmpeg)?.path;
const skip = browser === undefined ? 'no browser is installed' : ffmpeg === undefined || ffprobe === undefined ? 'ffmpeg is not installed' : false;
const spec: RenderSpec = { fps: 30, width: 480, height: 270 };
const never = new AbortController().signal;
/** The frame of the fixture's title card on which the title has finished entering (the still gate's default frame). */
const shownFrame = 26;

/** The pixel format ffprobe reads from a PNG. */
function pixelFormat(path: string): string {
  const result = spawnSync(ffprobe ?? '', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', path], { shell: false, timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr.toString('utf8'));
  return result.stdout.toString('utf8').trim();
}

/** The frame's pixels as raw rgba bytes, decoded by ffmpeg the way src/calibration/measure.ts reads rgb24 dumps; `crop` narrows it to a region. */
function rgbaBytes(path: string, crop?: string): Buffer {
  const filter = crop === undefined ? [] : ['-vf', `crop=${crop}`];
  const result = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-i', path, ...filter, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { shell: false, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString('utf8'));
  return result.stdout;
}

describe('a text plate captured through the installed browser', { skip }, () => {
  const log = new MemoryLogger();
  let dir = '';
  let harness: HarnessServer | undefined;
  let renderer: BrowserRenderer | undefined;
  const shot = mutated(planShotSpec, (copy) => { copy.width = spec.width; copy.height = spec.height; }).shots.find((candidate) => candidate.id === 's03');

  before(async () => {
    assert.ok(browser !== undefined && shot !== undefined && shot.text.length > 0, 'the fixture has the title card s03 with text');
    dir = mkdtempSync(join(tmpdir(), 'vf-text-plate-'));
    const pageDir = ensureDirectory(join(dir, 'page'));
    writeShotPage(pageDir, spec.width, spec.height);
    harness = new HarnessServer({ roots: renderServedRoots({ repoRoot: repositoryRoot, pageDir, dataDir: ensureDirectory(join(dir, 'data')) }), log });
    await harness.start(never);
    renderer = await openBrowserRenderer({ channel: browser.channel, executablePath: browser.path, version: '0.0.0.0', dataDir: ensureDirectory(join(dir, 'profile-data')), policy: 'any', width: spec.width, height: spec.height, log }, never);
  }, { timeout: 120_000 });

  after(async () => {
    await renderer?.close();
    await harness?.stop();
    rmSync(dir, { recursive: true, force: true });
  }, { timeout: 60_000 });

  it('writes a PNG with an alpha channel whose corner is transparent and whose text box holds opaque pixels, while the picture plate of the same frame is opaque throughout', { timeout: 60_000 }, async () => {
    assert.ok(renderer !== undefined && harness !== undefined && shot !== undefined);
    const text = join(dir, 'text.png');
    await renderer.capture({ pageUrl: pageUrl(harness.url), spec: buildShotPageSpec(shot, planLook, spec, null, 'text'), frames: [shownFrame], framePath: (): string => text }, never);
    assert.equal(pixelFormat(text), 'rgba');
    const corner = rgbaBytes(text, '1:1:0:0');
    assert.equal(corner[3], 0, `the corner pixel is transparent: rgba ${Array.from(corner).join(',')}`);
    const element = shot.text[0];
    assert.ok(element !== undefined);
    const box = rgbaBytes(text, `${Math.round(element.box.w * spec.width)}:${Math.round(element.box.h * spec.height)}:${Math.round(element.box.x * spec.width)}:${Math.round(element.box.y * spec.height)}`);
    let opaque = 0;
    for (let at = 3; at < box.length; at += 4) if ((box[at] ?? 0) > 0) opaque += 1;
    assert.ok(opaque > 0 && opaque < box.length / 4, `${opaque} of ${box.length / 4} pixels in the text box carry alpha: the words are there and so is the transparency around them`);

    const picture = join(dir, 'picture.png');
    await renderer.capture({ pageUrl: pageUrl(harness.url), spec: buildShotPageSpec(shot, planLook, spec, null), frames: [shownFrame], framePath: (): string => picture }, never);
    const whole = rgbaBytes(picture);
    let transparent = 0;
    for (let at = 3; at < whole.length; at += 4) if ((whole[at] ?? 255) < 255) transparent += 1;
    assert.equal(transparent, 0, 'the picture plate paints the whole frame');
  });
});
