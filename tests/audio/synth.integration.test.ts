/**
 * The real voice: runs only when VF_NARRATION_DATA_DIR names a data
 * directory where `audio install` (or the scratch install of the M6 build)
 * has put the component and the four pinned files. It loads the model,
 * synthesises two sentences with af_heart through the installed ffmpeg and
 * holds the WAV's probed duration to the sample-count timing, the loudness
 * to the targets and the SRT to two cues; the timings and the DirectML
 * answer are printed as diagnostics for the handoff.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { componentStatus } from '../../src/audio/component.ts';
import { loadKokoro } from '../../src/audio/kokoro-loader.ts';
import { narrationLoudnessTarget, narrationTruePeakCeiling } from '../../src/audio/loudness.ts';
import { synthesizeNarration } from '../../src/audio/synth.ts';
import type { NarrationDocument } from '../../src/audio/synth.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import { ChildProcessRunner } from '../../src/process/child-process-runner.ts';
import { findFfmpeg, findFfprobe } from '../../src/tools/ffmpeg.ts';

const dataDir = process.env['VF_NARRATION_DATA_DIR'];
const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe(ffmpeg?.path);
const installed = dataDir !== undefined && componentStatus(dataDir).installed;
const skip = dataDir === undefined ? 'VF_NARRATION_DATA_DIR is not set' : !installed ? `the component is not installed under ${dataDir}` : ffmpeg === undefined || ffprobe === undefined ? 'ffmpeg is not installed' : false;
const never = new AbortController().signal;

describe('audio synth through the real narration component', { skip }, () => {
  const runner = new ChildProcessRunner();
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-synth-real-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('synthesises two sentences with af_heart whose probed duration, loudness and captions agree with the document', async (test) => {
    const loadStarted = Date.now();
    const handle = await loadKokoro(dataDir ?? '');
    const loadSeconds = (Date.now() - loadStarted) / 1000;
    const log = new MemoryLogger();
    let document: NarrationDocument;
    try {
      document = await synthesizeNarration({
        dataDir: dataDir ?? '',
        text: 'The bottle holds 500 ml. Made by hand, since 1998.',
        voice: 'af_heart',
        outDir: join(dir, 'narration'),
        fps: 30,
        runner,
        ffmpegPath: ffmpeg?.path ?? '',
        ffprobePath: ffprobe?.path ?? '',
        log,
        signal: never,
        now: () => new Date(),
        handle,
      });
    } finally {
      // A supplied handle stays open after synthesizeNarration; the test loaded it, so the test releases it.
      await handle.dispose();
    }
    assert.equal(document.sentences.length, 2);
    assert.equal(document.sampleRate, 24_000);
    const lastSentence = document.sentences[document.sentences.length - 1];
    const expectedSeconds = lastSentence?.endSeconds ?? 0;
    assert.ok(expectedSeconds > 2, `two spoken sentences last more than two seconds, got ${expectedSeconds}`);
    const probe = await runner.run({ label: 'ffprobe', executable: ffprobe?.path ?? '', args: ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration,sample_rate,channels', '-of', 'json', document.wavPath], timeoutMs: 30_000 }, never);
    assert.equal(probe.exitCode, 0, probe.stderr);
    const stream = (JSON.parse(probe.stdout) as { streams: { duration: string; sample_rate: string; channels: number }[] }).streams[0];
    const probedSeconds = Number(stream?.duration);
    assert.ok(Math.abs(probedSeconds - expectedSeconds) <= expectedSeconds * 0.1, `ffprobe ${probedSeconds} s against the timing ${expectedSeconds} s`);
    assert.equal(stream?.sample_rate, '24000');
    assert.equal(stream?.channels, 1);
    assert.ok(Math.abs(document.loudness.integratedLufs - narrationLoudnessTarget) <= 1, `integrated ${document.loudness.integratedLufs} LUFS`);
    assert.ok(document.loudness.truePeakDbtp <= narrationTruePeakCeiling, `true peak ${document.loudness.truePeakDbtp} dBTP`);
    const srt = readFileSync(document.srtPath, 'utf8');
    assert.match(srt, /^1\n00:00:00,000 --> 00:00:0\d,\d{3}\nThe bottle holds five hundred millilitres\.\n\n2\n/);
    assert.ok(srt.includes('Made by hand, since nineteen ninety-eight.'));
    assert.equal(document.totalFrames, Math.ceil(expectedSeconds * 30));
    test.diagnostic(`model load ${loadSeconds.toFixed(2)} s; synthesis ${document.synthesisSeconds.toFixed(2)} s for ${document.sentences.map((sentence) => `${(sentence.endSeconds - sentence.startSeconds).toFixed(2)} s`).join(' + ')} of speech; loudness ${document.loudness.integratedLufs} LUFS, peak ${document.loudness.truePeakDbtp} dBTP; DirectML mapped: ${document.directMlMapped ? 'yes' : 'no'}`);
    for (const line of log.messages.filter((message) => message.startsWith('info: sentence'))) test.diagnostic(line);
  });
});
