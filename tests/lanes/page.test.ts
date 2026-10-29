import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { VisionForgeError } from '../../src/errors/vision-forge-error.ts';
import { importMapScriptTag } from '../../src/harness/import-map.ts';
import { pageUrl, shotPageHtml, writeShotPage } from '../../src/lanes/html/page.ts';
import { fontsUrlPrefix, pageFileName, rootElementId, runtimeModulePath, sourceUrlPrefix } from '../../src/shared/harness/protocol.ts';
import { bundledFonts, fontFaceCss } from '../../src/shared/typography/scale.ts';

describe('shotPageHtml', () => {
  const html = shotPageHtml(1920, 1080);

  it('starts with the doctype, the charset and the title and ends with the body holding only the root element', () => {
    assert.ok(html.startsWith('<!doctype html><html><head><meta charset="utf-8"><title>vision-forge</title>\n'));
    assert.ok(html.endsWith(`</head><body><div id="${rootElementId}"></div></body></html>\n`));
    assert.equal(html.split('<div').length, 2);
  });

  it('sizes the root element to the frame and hides overflow on a black page', () => {
    assert.ok(html.includes(`#${rootElementId}{position:relative;width:1920px;height:1080px;overflow:hidden}`));
    assert.ok(html.includes('html,body{margin:0;padding:0;background:#000;overflow:hidden}'));
    assert.ok(shotPageHtml(480, 270).includes('width:480px;height:270px'));
  });

  it('carries the @font-face rules of the four bundled fonts under the fonts prefix inside the style element', () => {
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(style.includes(fontFaceCss(fontsUrlPrefix)));
    for (const font of Object.values(bundledFonts)) assert.ok(style.includes(`url('${fontsUrlPrefix}${font.file}')`), font.file);
  });

  it('places the import map before the one module script, which is the runtime entry under the source prefix', () => {
    const importMapAt = html.indexOf(importMapScriptTag());
    const moduleAt = html.indexOf(`<script type="module" src="${sourceUrlPrefix}${runtimeModulePath}"></script>`);
    assert.ok(importMapAt > 0, 'import map present');
    assert.ok(moduleAt > importMapAt, 'module script after the import map');
    assert.equal(html.split('<script').length, 3, 'exactly two script elements');
  });

  it('refuses a size that is not a pair of positive whole pixels', () => {
    for (const [width, height] of [[0, 1080], [1920, -1], [1920.5, 1080], [Number.NaN, 1080]]) {
      assert.throws(() => shotPageHtml(width ?? 0, height ?? 0), (error: unknown) => error instanceof VisionForgeError && error.code === 'page-size');
    }
  });
});

describe('writeShotPage and pageUrl', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-page-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes index.html into the page directory, creating it, and returns its path', () => {
    const pageDir = join(dir, 'job', 's01', 'page');
    const path = writeShotPage(pageDir, 640, 360);
    assert.equal(path, join(pageDir, pageFileName));
    assert.equal(readFileSync(path, 'utf8'), shotPageHtml(640, 360));
  });

  it('builds the page URL from the harness URL with or without a trailing slash', () => {
    assert.equal(pageUrl('http://127.0.0.1:5123'), 'http://127.0.0.1:5123/page/index.html');
    assert.equal(pageUrl('http://127.0.0.1:5123/'), 'http://127.0.0.1:5123/page/index.html');
  });
});
