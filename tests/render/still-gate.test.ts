import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DataFileError } from '../../src/errors/vision-forge-error.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import type { ProcessSpec } from '../../src/process/process-runner.ts';
import { contrastRatio, relativeLuminanceOfHex, relativeLuminanceOfLuma } from '../../src/qa/luminance.ts';
import { round } from '../../src/qa/check.ts';
import { compositionCheck, describeFailures, gateReportPath, readGateReport, runStillGate } from '../../src/render/still-gate.ts';
import type { StillGateInputs } from '../../src/render/still-gate.ts';
import { findFfmpeg } from '../../src/tools/ffmpeg.ts';
import { FakeProcessRunner, matchProgram, okResult } from '../fakes/fake-process-runner.ts';
import { writeSolidPng } from '../fakes/png.ts';
import { lookBibleExample, mutated, shotExample, textExample } from '../schema/documents/examples.ts';
import { smallSpec } from './fixtures.ts';

const never = new AbortController().signal;
const ffmpeg = findFfmpeg();
const look = lookBibleExample;
const textShot = mutated(shotExample('s03', 120, 'html'), (copy) => { copy.text = [textExample]; });
const plainShot = shotExample('s02', 90, 'html');

/** A side effect that writes the signalstats print file named in the -vf argument, as the metadata filter would. */
function printsYavg(yavg: number): (spec: ProcessSpec) => void {
  return (spec: ProcessSpec): void => {
    const filter = spec.args[spec.args.indexOf('-vf') + 1] ?? '';
    const match = /file='([^']+)'/.exec(filter);
    assert.ok(match !== null, `no stats file in ${filter}`);
    writeFileSync(match[1]!.replace(/\\:/g, ':'), `frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=${yavg}\n`, 'utf8');
  };
}

/** The ratio the gate must compute for the look's text colour over a box luma. */
function expectedRatio(yavg: number): number {
  return round(contrastRatio(relativeLuminanceOfHex(look.palette.text), relativeLuminanceOfLuma(yavg)), 2);
}

describe('still gate with a scripted ffmpeg', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-gate-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  function inputs(runner: FakeProcessRunner, shot: typeof textShot, name: string): StillGateInputs {
    return { runner, ffmpegPath: 'C:\\tools\\ffmpeg.exe', shot, look, spec: smallSpec, finishedPng: join(dir, `${name}.png`), workDir: join(dir, `${name}-work`), signal: never };
  }

  it('passes a well-composed text shot whose box is dark and whose still sits inside the exposure band, and writes the report beside the still', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(40));
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(85));
    const gate = inputs(runner, textShot, 'pass');
    const report = await runStillGate(gate);
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.deepEqual(report.checks.map((check) => [check.id, check.ok]), [['composition', true], ['text-contrast', true], ['exposure', true]]);
    assert.equal(report.checks[1]?.measured, expectedRatio(40));
    assert.equal(report.checks[1]?.threshold, 4.5);
    assert.match(report.checks[1]?.detail ?? '', /t1 \(title\): [0-9.]+:1 against text #f4f1ea over box luma 40/);
    assert.equal(report.checks[2]?.measured, 85);
    assert.match(report.checks[2]?.detail ?? '', /inside the look's band 24 to 140/);
    assert.equal(readGateReport(gateReportPath(gate.finishedPng)).passed, true);
    assert.equal(gateReportPath(gate.finishedPng), join(dir, 'pass.gate.json'));
    // The box filter crops the text box of the 480x270 frame; the exposure filter sees the whole still.
    assert.match(runner.invocations[0]?.args.join(' ') ?? '', /crop=192:32:48:189,scale=out_color_matrix=bt709,format=yuv420p,signalstats/);
    assert.match(runner.invocations[1]?.args.join(' ') ?? '', /-vf scale=out_color_matrix=bt709,format=yuv420p,signalstats,metadata/);
    runner.assertAllUsed();
  });

  it('fails text whose box is as bright as the text, naming the ratio', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(160));
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(85));
    const report = await runStillGate(inputs(runner, textShot, 'bright'));
    assert.equal(report.passed, false);
    assert.equal(report.checks[1]?.ok, false);
    assert.equal(report.checks[1]?.measured, expectedRatio(160));
    assert.ok((report.checks[1]?.measured ?? 10) < 4.5);
    assert.match(describeFailures(report), /^text-contrast: t1 \(title\)/);
  });

  it('fails a still outside the exposure band and reports no text as ok', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult(), printsYavg(200));
    const report = await runStillGate(inputs(runner, plainShot, 'hot'));
    assert.equal(report.passed, false);
    assert.deepEqual(report.checks.map((check) => [check.id, check.ok]), [['composition', true], ['text-contrast', true], ['exposure', false]]);
    assert.equal(report.checks[1]?.detail, 'no text');
    assert.equal(report.checks[1]?.measured, null);
    assert.match(report.checks[2]?.detail ?? '', /200 YAVG outside/);
    assert.equal(runner.invocations.length, 1);
  });

  it('fails when signalstats prints nothing, instead of guessing', async () => {
    const runner = new FakeProcessRunner();
    runner.expect(matchProgram('ffmpeg.exe'), okResult());
    runner.expect(matchProgram('ffmpeg.exe'), okResult());
    const report = await runStillGate(inputs(runner, textShot, 'silent'));
    assert.equal(report.passed, false);
    assert.equal(report.checks[1]?.ok, false);
    assert.equal(report.checks[2]?.measured, null);
  });

  it('reports composition problems from the base framing with their count as the measurement', () => {
    const onSubject = mutated(textShot, (copy) => { copy.text = [{ ...textExample, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } }]; });
    const check = compositionCheck(onSubject, smallSpec);
    assert.equal(check.ok, false);
    assert.ok((check.measured ?? 0) >= 1);
    assert.match(check.detail, /overlaps the subject box/);
    assert.equal(compositionCheck(textShot, smallSpec).measured, 0);
  });

  it('refuses a report file that is not one', () => {
    writeFileSync(join(dir, 'odd.gate.json'), '{"hello":1}', 'utf8');
    assert.throws(() => readGateReport(join(dir, 'odd.gate.json')), DataFileError);
    assert.throws(() => readGateReport(join(dir, 'missing.gate.json')), DataFileError);
  });
});

describe('still gate with the installed ffmpeg', { skip: ffmpeg === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  const runner = new ChildProcessRunner();
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-gate-ffmpeg-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  function inputs(name: string): StillGateInputs {
    return { runner, ffmpegPath: ffmpeg?.path ?? '', shot: textShot, look, spec: smallSpec, finishedPng: join(dir, `${name}.png`), workDir: join(dir, `${name}-work`), signal: never };
  }

  it('fails the look\'s text over a uniform 18 percent gray still: the ratio is below 4.5', async () => {
    const gate = inputs('gray');
    writeSolidPng(gate.finishedPng, smallSpec.width, smallSpec.height, [0x76, 0x76, 0x76]);
    const report = await runStillGate(gate);
    assert.equal(report.checks[1]?.ok, false, JSON.stringify(report));
    assert.ok((report.checks[1]?.measured ?? 10) < 4.5);
    assert.equal(report.checks[2]?.ok, true, report.checks[2]?.detail);
    assert.equal(report.passed, false);
    assert.ok(existsSync(gateReportPath(gate.finishedPng)));
  });

  it('passes the look\'s text over a still in the look\'s background colour', async () => {
    const gate = inputs('dark');
    writeSolidPng(gate.finishedPng, smallSpec.width, smallSpec.height, [0x0b, 0x0b, 0x0f]);
    const report = await runStillGate(gate);
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.ok((report.checks[1]?.measured ?? 0) > 4.5);
    assert.ok((report.checks[2]?.measured ?? 0) >= look.qa.yavgMin, report.checks[2]?.detail);
  });
});
