import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ToolMissingError, UsageError } from '../../src/errors/vision-forge-error.ts';
import { RenderProfileMismatchError, assertRendererMatches, effectivePolicy, framesOf, parseFrameRange, parseRendererPolicy, parseScale, parseStillFrame, readRenderTools } from '../../src/render/command-support.ts';
import type { RenderProfile } from '../../src/shared/contracts/shot-spec.ts';
import { writeToolsManifest } from '../../src/tools/tools-manifest.ts';
import { mutated, shotExample } from '../schema/documents/examples.ts';
import { edgeExample, toolsManifestExample } from './fixtures.ts';

const hardware: RenderProfile = { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' };
const software: RenderProfile = { engine: 'chromium', backend: 'swiftshader-webgl', renderer: 'software' };
const unpinned = shotExample('s01', 60, 'html');
const pinnedHardware = mutated(unpinned, (copy) => { copy.id = 's02'; copy.renderProfile = hardware; });
const pinnedSoftware = mutated(unpinned, (copy) => { copy.id = 's03'; copy.renderProfile = software; });

describe('renderer policy and pinned profiles', () => {
  it('parses --renderer with any as the default', () => {
    assert.equal(parseRendererPolicy(undefined), 'any');
    assert.equal(parseRendererPolicy('software'), 'software');
    assert.throws(() => parseRendererPolicy('gpu'), (error: unknown) => error instanceof UsageError && /--renderer must be one of hardware, software, any/.test(error.message));
  });

  it('adopts the pinned renderer under any and keeps the asked-for policy when nothing is pinned', () => {
    assert.equal(effectivePolicy('any', [unpinned]), 'any');
    assert.equal(effectivePolicy('software', [unpinned]), 'software');
    assert.equal(effectivePolicy('any', [unpinned, pinnedSoftware]), 'software');
    assert.equal(effectivePolicy('hardware', [pinnedHardware]), 'hardware');
  });

  it('refuses a fixed policy that disagrees with a pinned profile, and two pinned shots that disagree', () => {
    assert.throws(() => effectivePolicy('software', [pinnedHardware]), (error: unknown) => error instanceof RenderProfileMismatchError && error.code === 'render-profile-mismatch' && /"s02".*hardware.*--renderer software/.test(error.message));
    assert.throws(() => effectivePolicy('hardware', [pinnedSoftware]), RenderProfileMismatchError);
    assert.throws(() => effectivePolicy('any', [pinnedHardware, pinnedSoftware]), (error: unknown) => error instanceof RenderProfileMismatchError && /"s02".*"s03"/.test(error.message));
  });

  it('checks the browser that opened against the pinned profiles', () => {
    assert.doesNotThrow(() => assertRendererMatches(hardware, [unpinned, pinnedHardware]));
    assert.throws(() => assertRendererMatches(software, [pinnedHardware]), (error: unknown) => error instanceof RenderProfileMismatchError && /opened with the software renderer/.test(error.message));
  });
});

describe('frame arguments', () => {
  it('parses --frames a-b and refuses anything else', () => {
    assert.equal(parseFrameRange(undefined), undefined);
    assert.deepEqual(parseFrameRange('0-11'), { first: 0, last: 11 });
    assert.deepEqual(parseFrameRange(' 5-5 '), { first: 5, last: 5 });
    assert.throws(() => parseFrameRange('0..11'), (error: unknown) => error instanceof UsageError && /--frames must be <first>-<last>/.test(error.message));
    assert.throws(() => parseFrameRange('11-0'), (error: unknown) => error instanceof UsageError && /runs backwards/.test(error.message));
  });

  it('lists the frames of a shot, whole or within the range, and refuses a range past the end', () => {
    const shot = shotExample('s01', 4, 'html');
    assert.deepEqual(framesOf(shot, undefined), [0, 1, 2, 3]);
    assert.deepEqual(framesOf(shot, { first: 1, last: 2 }), [1, 2]);
    assert.throws(() => framesOf(shot, { first: 0, last: 4 }), (error: unknown) => error instanceof UsageError && /out of range for shot "s01", which has frames 0 to 3/.test(error.message));
  });

  it('checks --frame against the shot and --scale for a whole number', () => {
    const shot = shotExample('s01', 4, 'html');
    assert.equal(parseStillFrame(undefined, shot), undefined);
    assert.equal(parseStillFrame(3, shot), 3);
    assert.throws(() => parseStillFrame(4, shot), (error: unknown) => error instanceof UsageError && /--frame 4 is out of range/.test(error.message));
    assert.throws(() => parseStillFrame(1.5, shot), UsageError);
    assert.equal(parseScale(undefined), 1);
    assert.equal(parseScale(2), 2);
    assert.throws(() => parseScale(0), UsageError);
    assert.throws(() => parseScale(1.5), UsageError);
  });
});

describe('readRenderTools', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-render-tools-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('takes ffmpeg and the first browser from tools.json', () => {
    const dataDir = join(dir, 'full');
    writeToolsManifest(dataDir, toolsManifestExample('C:\\tools\\ffmpeg.exe', [edgeExample, { ...edgeExample, channel: 'chrome' }]));
    const tools = readRenderTools(dataDir);
    assert.equal(tools.ffmpeg.path, 'C:\\tools\\ffmpeg.exe');
    assert.equal(tools.browser.channel, 'msedge');
  });

  it('prefers the browser the shot key names: the first with a WebGL report, else the first listed', () => {
    const edgeWithoutReport = { ...edgeExample, webgl: null };
    const chrome = { ...edgeExample, channel: 'chrome' as const };
    const reported = join(dir, 'chrome-reported');
    writeToolsManifest(reported, toolsManifestExample('C:\\tools\\ffmpeg.exe', [edgeWithoutReport, chrome]));
    assert.equal(readRenderTools(reported).browser.channel, 'chrome');
    const unreported = join(dir, 'none-reported');
    writeToolsManifest(unreported, toolsManifestExample('C:\\tools\\ffmpeg.exe', [edgeWithoutReport, { ...chrome, webgl: null }]));
    assert.equal(readRenderTools(unreported).browser.channel, 'msedge');
  });

  it('names the missing program with its install hint', () => {
    const noFfmpeg = join(dir, 'no-ffmpeg');
    writeToolsManifest(noFfmpeg, toolsManifestExample(undefined, [edgeExample]));
    assert.throws(() => readRenderTools(noFfmpeg), (error: unknown) => error instanceof ToolMissingError && error.tool === 'ffmpeg');
    const noBrowser = join(dir, 'no-browser');
    writeToolsManifest(noBrowser, toolsManifestExample('C:\\tools\\ffmpeg.exe', []));
    assert.throws(() => readRenderTools(noBrowser), (error: unknown) => error instanceof ToolMissingError && /browser/i.test(error.tool) && /edge|chrome/i.test(error.hint));
  });
});
