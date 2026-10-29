/**
 * The M3 determinism test of ADR 0006 decision 6 and the first golden of
 * decision 7: the title-card fixture is rendered at 480x270 in ten fresh
 * browser launches (VF_DETERMINISM_RUNS overrides the count) and every
 * frame's pixel hash must agree across the runs; frame 26 of the first
 * run is then compared with the committed golden by SSIM, strictly when
 * the recorded fingerprint matches this machine's and loosely otherwise.
 * VF_UPDATE_GOLDENS=1 rewrites the golden and its fingerprint sidecar;
 * VF_EVIDENCE_OUT=<file> writes the hash table as Markdown for the docs.
 */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { ensureDirectory } from '../../src/fs/paths.ts';
import { openBrowserRenderer } from '../../src/harness/browser-session.ts';
import { HarnessServer } from '../../src/harness/harness-server.ts';
import { renderServedRoots, repositoryRoot } from '../../src/harness/served-roots.ts';
import type { BrowserFingerprint } from '../../src/harness/types.ts';
import { pageUrl, writeShotPage } from '../../src/lanes/html/page.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { runAnalysis } from '../../src/qa/check.ts';
import { parseSsimSummary } from '../../src/qa/parse.ts';
import { heroStillArgs } from '../../src/qa/still-match.ts';
import { hashFrames } from '../../src/render/framehash.ts';
import { buildShotPageSpec } from '../../src/render/shot-page-spec.ts';
import { majorVersion } from '../../src/plan/shot-key.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import { browserVersion } from '../../src/tools/browsers.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { testBrowser } from '../fakes/test-browser.ts';
import { planLook, planShotSpec } from '../plan/fixtures.ts';
import { mutated } from '../schema/documents/examples.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const browser = testBrowser();
const ffmpeg = findFfmpeg()?.path;
const skip = browser === undefined ? 'no browser is installed' : ffmpeg === undefined ? 'ffmpeg is not installed' : false;
const runs = Math.max(2, Number(process.env['VF_DETERMINISM_RUNS'] ?? '10'));
const frames = [0, 26, 60, 119];
const goldenFrame = 26;
const spec: RenderSpec = { fps: 30, width: 480, height: 270 };
const goldenDir = join(repoRoot, 'tests', 'goldens', 'html');
const goldenPath = join(goldenDir, `title-card-${spec.width}x${spec.height}-f${String(goldenFrame).padStart(3, '0')}.png`);
const sidecarPath = goldenPath.replace(/\.png$/, '.fingerprint.json');
const strictSsim = 0.99;
const looseSsim = 0.95;
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

/** What the golden's sidecar records: enough to tell "same fingerprint" from "another machine". */
interface GoldenFingerprint {
  readonly platform: string;
  readonly channel: string;
  readonly browserMajor: number | null;
  readonly webglRenderer: string;
  readonly args: readonly string[];
}

function goldenFingerprintOf(fingerprint: BrowserFingerprint): GoldenFingerprint {
  return { platform: process.platform, channel: fingerprint.channel, browserMajor: majorVersion(fingerprint.version), webglRenderer: fingerprint.webglRenderer, args: [...fingerprint.args] };
}

function sameFingerprint(a: GoldenFingerprint, b: GoldenFingerprint): boolean {
  return a.platform === b.platform && a.channel === b.channel && a.browserMajor === b.browserMajor && a.webglRenderer === b.webglRenderer && a.args.join(' ') === b.args.join(' ');
}

interface RunResult {
  readonly name: string;
  readonly hashes: ReadonlyMap<number, string>;
  readonly dir: string;
  readonly fingerprint: BrowserFingerprint;
  readonly launchMs: number;
  readonly screenshotMs: readonly number[];
}

describe('html lane determinism and golden at 480x270', { skip }, () => {
  let dir = '';
  let harness: HarnessServer | undefined;
  let version = '0.0.0.0';
  const results: RunResult[] = [];
  const shot = mutated(planShotSpec, (copy) => { copy.width = spec.width; copy.height = spec.height; }).shots[2]!;
  const pageSpec = buildShotPageSpec(shot, planLook, spec);

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-determinism-'));
    const pageDir = ensureDirectory(join(dir, 'page'));
    writeShotPage(pageDir, spec.width, spec.height);
    harness = new HarnessServer({ roots: renderServedRoots({ repoRoot: repositoryRoot, pageDir, dataDir: ensureDirectory(join(dir, 'data')) }), log: new MemoryLogger() });
    await harness.start(never);
    if (browser !== undefined) version = (await browserVersion(runner, browser.path)) ?? version;
  });
  after(async () => {
    await harness?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it(`renders identical pixels in ${runs} fresh browser launches`, { timeout: 60_000 * runs }, async (t) => {
    assert.ok(browser !== undefined && ffmpeg !== undefined && harness !== undefined);
    for (let index = 1; index <= runs; index += 1) {
      const name = `run-${index}`;
      const runDir = ensureDirectory(join(dir, name));
      const dataDir = ensureDirectory(join(runDir, 'data'));
      const started = process.hrtime.bigint();
      const renderer = await openBrowserRenderer({ channel: browser.channel, executablePath: browser.path, version, dataDir, policy: 'any', width: spec.width, height: spec.height, log: new MemoryLogger() }, never);
      try {
        const captured = await renderer.capture({ pageUrl: pageUrl(harness.url), spec: pageSpec, frames, framePath: (frame) => join(runDir, `f${String(frame).padStart(6, '0')}.png`) }, never);
        const launchMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        const hashes = await hashFrames(runner, ffmpeg, runDir, frames, never);
        results.push({ name, hashes, dir: runDir, fingerprint: renderer.fingerprint, launchMs, screenshotMs: captured.map((frame) => frame.screenshotMs) });
      } finally {
        await renderer.close();
      }
    }
    const first = results[0]!;
    const rows = results.map((run) => `| ${run.name} | ${frames.map((frame) => (run.hashes.get(frame) ?? '').slice(0, 16)).join(' | ')} | ${run.launchMs.toFixed(0)} | ${run.screenshotMs.map((ms) => ms.toFixed(0)).join(', ')} |`);
    const table = [`| Run | ${frames.map((frame) => `k=${frame}`).join(' | ')} | launch to last frame (ms) | screenshot ms per frame |`, `| --- | ${frames.map(() => '---').join(' | ')} | --- | --- |`, ...rows].join('\n');
    t.diagnostic(`${browser.channel} ${first.fingerprint.version} ${first.fingerprint.webglRenderer}\n${table}`);
    const evidenceOut = process.env['VF_EVIDENCE_OUT'];
    if (evidenceOut !== undefined && evidenceOut.length > 0) {
      writeFileSync(evidenceOut, `Browser: ${browser.channel} ${first.fingerprint.version}, renderer ${first.fingerprint.webglRenderer}, args ${first.fingerprint.args.join(' ')}.\n\n${table}\n`, 'utf8');
    }
    for (const frame of frames) {
      const distinct = new Set(results.map((run) => run.hashes.get(frame)));
      assert.equal(distinct.size, 1, `frame ${frame} produced ${distinct.size} distinct hashes across ${runs} runs: ${[...distinct].join(', ')}`);
      assert.match(first.hashes.get(frame) ?? '', /^[0-9a-f]{64}$/);
    }
    assert.notEqual(first.hashes.get(0), first.hashes.get(goldenFrame), 'frame 0 (before the title enters) differs from frame 26 (title shown)');
  });

  it('matches the committed golden of frame 26 by SSIM (strictly on the same fingerprint, loosely elsewhere)', { timeout: 120_000 }, async (t) => {
    assert.ok(ffmpeg !== undefined);
    const first = results[0];
    assert.ok(first !== undefined, 'the determinism runs produced a frame');
    const rendered = join(first.dir, `f${String(goldenFrame).padStart(6, '0')}.png`);
    const fingerprint = goldenFingerprintOf(first.fingerprint);
    if (process.env['VF_UPDATE_GOLDENS'] === '1' || !existsSync(goldenPath)) {
      if (process.env['VF_UPDATE_GOLDENS'] !== '1') assert.fail(`${goldenPath} is missing; run this test once with VF_UPDATE_GOLDENS=1 to create it`);
      ensureDirectory(goldenDir);
      copyFileSync(rendered, goldenPath);
      writeJsonAtomic(sidecarPath, fingerprint);
      t.diagnostic(`golden written: ${goldenPath}`);
      return;
    }
    const recorded = readJsonFile(sidecarPath) as GoldenFingerprint;
    const strict = sameFingerprint(recorded, fingerprint);
    const result = await runAnalysis(runner, ffmpeg, heroStillArgs(goldenPath, rendered), 'ffmpeg ssim', never);
    const ssim = parseSsimSummary(result.stderr);
    assert.ok(ssim !== undefined, 'ffmpeg printed an SSIM summary');
    const threshold = strict ? strictSsim : looseSsim;
    t.diagnostic(`golden SSIM ${ssim.toFixed(5)} against threshold ${threshold} (${strict ? 'same fingerprint' : `different fingerprint: golden ${recorded.channel} ${String(recorded.browserMajor)} on ${recorded.platform}, ${recorded.webglRenderer}`})`);
    assert.ok(ssim >= threshold, `SSIM ${ssim.toFixed(5)} against the golden is below ${threshold}`);
  });
});
