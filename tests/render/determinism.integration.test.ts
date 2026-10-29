/**
 * The determinism test of ADR 0006 decision 6 and the goldens of decision
 * 7, one per browser lane: the html lane's title-card fixture (s03) and
 * the three lane's product shot (s01, the push-in on the bottle under the
 * built-in room environment, since the test's data directory holds no
 * HDRI) are rendered at 480x270 in ten fresh browser launches each
 * (VF_DETERMINISM_RUNS overrides the count) and every frame's pixel hash
 * must agree across the runs for the html lane; for the three lane a run
 * whose hash differs must still be within `gpuNoisePsnrDb` of the first
 * run (ADR 0006 decision 6 as amended: the GPU flips a single pixel by
 * one code value in about one capture in fifty). The golden frame of the first run is then
 * compared with the committed golden by SSIM, strictly when the recorded
 * fingerprint matches this machine's and loosely otherwise.
 * VF_UPDATE_GOLDENS=1 rewrites the goldens and their fingerprint sidecars;
 * VF_EVIDENCE_OUT=<file.md> writes each lane's hash table as Markdown
 * (the lane's name is appended to the file name) for the docs;
 * VF_KEEP_RUNS=1 leaves every run's frames in the temp folder (its path
 * is printed) so a differing frame can be diffed by hand.
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
import { parsePsnrSummary, parseSsimSummary } from '../../src/qa/parse.ts';
import { heroStillArgs, psnrArgs } from '../../src/qa/still-match.ts';
import { hashFrames } from '../../src/render/framehash.ts';
import { buildShotPageSpec } from '../../src/render/shot-page-spec.ts';
import { majorVersion } from '../../src/plan/shot-key.ts';
import type { RenderSpec } from '../../src/shared/camera/types.ts';
import type { BrowserLane } from '../../src/shared/harness/protocol.ts';
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
const spec: RenderSpec = { fps: 30, width: 480, height: 270 };
const strictSsim = 0.99;
const looseSsim = 0.95;
/** The PSNR a three-lane run must keep against the first run when its hash differs: 80 dB is one code value on 0.07 percent of the pixels; the observed flips are one pixel (about 100 dB). */
const gpuNoisePsnrDb = 80;
const runner = new ChildProcessRunner();
const never = new AbortController().signal;

/** One lane's case: the fixture shot it renders, the frames it hashes and the frame its golden holds. */
interface LaneCase {
  readonly lane: BrowserLane;
  readonly shotId: string;
  readonly goldenName: string;
  readonly frames: readonly number[];
  readonly goldenFrame: number;
  readonly goldenDescription: string;
  /** Whether every run's hash must match (html) or a differing run may pass on PSNR (three). */
  readonly hashesMustMatch: boolean;
}

const laneCases: readonly LaneCase[] = [
  { lane: 'html', shotId: 's03', goldenName: 'title-card', frames: [0, 26, 60, 119], goldenFrame: 26, goldenDescription: 'frame 0 (before the title enters) differs from frame 26 (title shown)', hashesMustMatch: true },
  { lane: 'three', shotId: 's01', goldenName: 'product-shot', frames: [0, 26, 60, 104], goldenFrame: 60, goldenDescription: 'frame 0 (the start of the push-in) differs from frame 60 (half way in)', hashesMustMatch: false },
];

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

function frameName(frame: number): string {
  return `f${String(frame).padStart(6, '0')}.png`;
}

for (const laneCase of laneCases) {
  const { lane, frames, goldenFrame } = laneCase;
  const goldenDir = join(repoRoot, 'tests', 'goldens', lane);
  const goldenPath = join(goldenDir, `${laneCase.goldenName}-${spec.width}x${spec.height}-f${String(goldenFrame).padStart(3, '0')}.png`);
  const sidecarPath = goldenPath.replace(/\.png$/, '.fingerprint.json');

  describe(`${lane} lane determinism and golden at 480x270`, { skip }, () => {
    let dir = '';
    let harness: HarnessServer | undefined;
    let version = '0.0.0.0';
    const results: RunResult[] = [];
    const shot = mutated(planShotSpec, (copy) => { copy.width = spec.width; copy.height = spec.height; }).shots.find((candidate) => candidate.id === laneCase.shotId);
    assert.ok(shot !== undefined && shot.lane === lane, `the plan fixture has the ${lane} shot ${laneCase.shotId}`);
    const pageSpec = buildShotPageSpec(shot, planLook, spec);

    before(async () => {
      dir = mkdtempSync(join(tmpdir(), `vf-determinism-${lane}-`));
      const pageDir = ensureDirectory(join(dir, 'page'));
      writeShotPage(pageDir, spec.width, spec.height);
      harness = new HarnessServer({ roots: renderServedRoots({ repoRoot: repositoryRoot, pageDir, dataDir: ensureDirectory(join(dir, 'data')) }), log: new MemoryLogger() });
      await harness.start(never);
      if (browser !== undefined) version = (await browserVersion(runner, browser.path)) ?? version;
    });
    after(async () => {
      await harness?.stop();
      if (process.env['VF_KEEP_RUNS'] === '1') console.error(`determinism runs kept under ${dir}`);
      else rmSync(dir, { recursive: true, force: true });
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
          const captured = await renderer.capture({ pageUrl: pageUrl(harness.url), spec: pageSpec, frames, framePath: (frame) => join(runDir, frameName(frame)) }, never);
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
      t.diagnostic(`${lane}: ${browser.channel} ${first.fingerprint.version} ${first.fingerprint.webglRenderer}\n${table}`);
      const evidenceOut = process.env['VF_EVIDENCE_OUT'];
      if (evidenceOut !== undefined && evidenceOut.length > 0) {
        const laneOut = evidenceOut.endsWith('.md') ? `${evidenceOut.slice(0, -3)}-${lane}.md` : `${evidenceOut}-${lane}`;
        writeFileSync(laneOut, `Lane ${lane}, shot ${laneCase.shotId}. Browser: ${browser.channel} ${first.fingerprint.version}, renderer ${first.fingerprint.webglRenderer}, args ${first.fingerprint.args.join(' ')}.\n\n${table}\n`, 'utf8');
      }
      let noisyCaptures = 0;
      for (const frame of frames) {
        const distinct = new Set(results.map((run) => run.hashes.get(frame)));
        assert.match(first.hashes.get(frame) ?? '', /^[0-9a-f]{64}$/);
        if (laneCase.hashesMustMatch || distinct.size === 1) {
          assert.equal(distinct.size, 1, `frame ${frame} produced ${distinct.size} distinct hashes across ${runs} runs: ${[...distinct].join(', ')}`);
          continue;
        }
        for (const run of results.slice(1)) {
          if (run.hashes.get(frame) === first.hashes.get(frame)) continue;
          noisyCaptures += 1;
          const psnr = parsePsnrSummary((await runAnalysis(runner, ffmpeg, psnrArgs(join(first.dir, frameName(frame)), join(run.dir, frameName(frame))), 'ffmpeg psnr', never)).stderr);
          assert.ok(psnr !== undefined, 'ffmpeg printed a PSNR summary');
          t.diagnostic(`${lane} frame ${frame} of ${run.name} differs from run-1 by hash; PSNR ${psnr.toFixed(1)} dB against the ${gpuNoisePsnrDb} dB floor`);
          assert.ok(psnr >= gpuNoisePsnrDb, `frame ${frame} of ${run.name} differs from run-1 by more than GPU noise: PSNR ${psnr.toFixed(1)} dB`);
        }
      }
      t.diagnostic(`${lane}: ${noisyCaptures} of ${runs * frames.length} captures differed from run-1 within the PSNR floor`);
      assert.notEqual(first.hashes.get(0), first.hashes.get(goldenFrame), laneCase.goldenDescription);
    });

    it(`matches the committed golden of frame ${goldenFrame} by SSIM (strictly on the same fingerprint, loosely elsewhere)`, { timeout: 120_000 }, async (t) => {
      assert.ok(ffmpeg !== undefined);
      const first = results[0];
      assert.ok(first !== undefined, 'the determinism runs produced a frame');
      const rendered = join(first.dir, frameName(goldenFrame));
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
      t.diagnostic(`${lane} golden SSIM ${ssim.toFixed(5)} against threshold ${threshold} (${strict ? 'same fingerprint' : `different fingerprint: golden ${recorded.channel} ${String(recorded.browserMajor)} on ${recorded.platform}, ${recorded.webglRenderer}`})`);
      assert.ok(ssim >= threshold, `SSIM ${ssim.toFixed(5)} against the golden is below ${threshold}`);
    });
  });
}
