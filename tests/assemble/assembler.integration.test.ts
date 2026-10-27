import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Assembler, jobTempDir } from '../../src/assemble/assembler.ts';
import { MemoryLogger } from '../../src/cli/logger.ts';
import type { AssemblyPlan } from '../../src/shared/contracts/assembly-plan.ts';
import { generateCube, identityGrade } from '../../src/shared/grade/grade.ts';
import { findFfmpeg, findFfprobe } from '../../src/tools/ffmpeg.ts';
import { clip, compare, countFrames, extractFrame, fileHash, integratedLoudness, makePlan, makeSyntheticSources, never, peakLuma, probeEntry, runner } from './support.ts';
import type { SyntheticSources } from './support.ts';

const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe(ffmpeg?.path);

describe('Assembler with the installed ffmpeg', { skip: ffmpeg === undefined || ffprobe === undefined ? 'ffmpeg is not installed' : false }, () => {
  let dir = '';
  let sources: SyntheticSources;
  let assembler: Assembler;
  const outputs: Record<string, string> = {};

  before(async () => {
    if (ffmpeg === undefined || ffprobe === undefined) return;
    dir = mkdtempSync(join(tmpdir(), 'vf-asm-it-'));
    sources = await makeSyntheticSources(ffmpeg.path, join(dir, 'src'));
    assembler = new Assembler(runner, ffmpeg.path, ffprobe.path, new MemoryLogger());
  });
  after(() => { if (dir.length > 0) rmSync(dir, { recursive: true, force: true }); });

  function out(name: string): string {
    return join(dir, 'out', name);
  }

  async function assembleAndCount(plan: AssemblyPlan): Promise<number> {
    const result = await assembler.assemble(plan, never);
    assert.equal(result.outputPath, plan.output.path);
    assert.ok(existsSync(plan.output.path), `delivery ${plan.output.path} exists`);
    assert.ok(!existsSync(jobTempDir(plan.output.path)), 'temp dir removed');
    return countFrames(ffprobe?.path ?? '', plan.output.path);
  }

  it('(a) joins two 30-frame clips with a cut into 60 frames', async () => {
    const plan = makePlan(sources, out('a-cut.mp4'));
    assert.equal(await assembleAndCount(plan), 60);
    outputs['a'] = plan.output.path;
  });

  it('(b) a 10-frame dissolve gives 50 frames', async () => {
    const plan = makePlan(sources, out('b-dissolve.mp4'), { transitions: [{ afterClipId: 'a', type: 'dissolve', frames: 10 }] });
    assert.equal(await assembleAndCount(plan), 50);
    outputs['b'] = plan.output.path;
  });

  it('(c) a wipe-left of 15 and a fade-black of 15 across three clips give 60 frames', async () => {
    const plan = makePlan(sources, out('c-three.mp4'), {
      clips: [clip('a', 'frames', sources.testsrcPattern), clip('b', 'frames', sources.colorPattern), clip('c', 'video', sources.videoPath)],
      transitions: [{ afterClipId: 'a', type: 'wipe-left', frames: 15 }, { afterClipId: 'b', type: 'fade-black', frames: 15 }],
    });
    assert.equal(await assembleAndCount(plan), 60);
  });

  it('(d) narration at two start frames over ducked music is normalized to -16 LUFS within 1 LU, reported within 0.5 LU of the ebur128 reading, over a 3 s audio stream', async () => {
    const plan = makePlan(sources, out('d-audio.mp4'), {
      clips: [clip('a', 'frames', sources.testsrcPattern), clip('b', 'frames', sources.colorPattern), clip('c', 'video', sources.videoPath)],
      audio: {
        narration: [{ path: sources.narration[0], startFrame: 10 }, { path: sources.narration[1], startFrame: 50 }],
        music: { path: sources.music, duckUnderNarration: true, gainDb: -12 },
        loudnessLufs: -16,
        truePeakDbtp: -1.5,
      },
    });
    const result = await assembler.assemble(plan, never);
    assert.equal(await countFrames(ffprobe?.path ?? '', plan.output.path), 90);
    assert.ok(result.loudness !== undefined && Number.isFinite(result.loudness.inputI));
    const measured = await integratedLoudness(ffmpeg?.path ?? '', plan.output.path);
    assert.ok(Math.abs(measured + 16) <= 1, `integrated loudness ${measured} LUFS`);
    const reported = result.loudness.outputI;
    assert.ok(reported !== undefined && Math.abs(reported - measured) <= 0.5, `loudnorm reported ${reported} LUFS, ebur128 measured ${measured} LUFS`);
    assert.equal(await probeEntry(ffprobe?.path ?? '', plan.output.path, 'duration', 'a:0'), '3.000000');
  });

  it('(e) burning captions in changes the frame at the caption time and leaves a frame before it alone', async () => {
    const plan = makePlan(sources, out('e-captions.mp4'), { captions: { srtPath: sources.srtPath, burnIn: true } });
    const result = await assembler.assemble(plan, never);
    assert.equal(result.sidecarPath, out('e-captions.srt'));
    assert.ok(existsSync(out('e-captions.srt')));
    const baseline = outputs['a'];
    assert.ok(baseline !== undefined, 'plan (a) ran first');
    const withCaptions = join(dir, 'e-with.png');
    const without = join(dir, 'e-without.png');
    await extractFrame(ffmpeg?.path ?? '', plan.output.path, 30, withCaptions);
    await extractFrame(ffmpeg?.path ?? '', baseline, 30, without);
    const { ssim } = await compare(ffmpeg?.path ?? '', without, withCaptions);
    assert.ok(ssim < 0.999, `SSIM at frame 30 ${ssim}`);
    const earlyWith = join(dir, 'e-early-with.png');
    const earlyWithout = join(dir, 'e-early-without.png');
    await extractFrame(ffmpeg?.path ?? '', plan.output.path, 5, earlyWith);
    await extractFrame(ffmpeg?.path ?? '', baseline, 5, earlyWithout);
    const early = await compare(ffmpeg?.path ?? '', earlyWithout, earlyWith);
    assert.ok(early.ssim >= 0.999, `SSIM at frame 5 ${early.ssim}`);
  });

  it('(f) an identity cube without grain delivers within 40 dB PSNR of the ungraded delivery', async () => {
    const cube = join(dir, 'identity.cube');
    writeFileSync(cube, generateCube(identityGrade), 'utf8');
    const plan = makePlan(sources, out('f-graded.mp4'), {
      transitions: [{ afterClipId: 'a', type: 'dissolve', frames: 10 }],
      grade: { cubePath: cube, vignetteAmount: 0, vignetteSoftness: 0.5, grainAmount: 0, grainSeed: 0 },
    });
    assert.equal(await assembleAndCount(plan), 50);
    const baseline = outputs['b'];
    assert.ok(baseline !== undefined, 'plan (b) ran first');
    const { psnr } = await compare(ffmpeg?.path ?? '', baseline, plan.output.path);
    assert.ok(psnr >= 40, `PSNR ${psnr} dB`);
  });

  it('(g) a prores delivery is a .mov in yuv422p10le with square pixels', async () => {
    const plan = makePlan(sources, out('g-prores.mov'), { output: { path: out('g-prores.mov'), codec: 'prores', crf: 16, preset: 'medium', faststart: false } });
    assert.equal(await assembleAndCount(plan), 60);
    assert.equal(await probeEntry(ffprobe?.path ?? '', plan.output.path, 'pix_fmt'), 'yuv422p10le');
    assert.equal(await probeEntry(ffprobe?.path ?? '', plan.output.path, 'sample_aspect_ratio'), '1:1');
  });

  it('(h) a vignette and seeded grain through the full chain give 50 frames that differ from the ungraded delivery, byte-identical on a second encode', async () => {
    const cube = join(dir, 'identity-h.cube');
    writeFileSync(cube, generateCube(identityGrade), 'utf8');
    const plan = makePlan(sources, out('h-grain.mp4'), {
      transitions: [{ afterClipId: 'a', type: 'dissolve', frames: 10 }],
      grade: { cubePath: cube, vignetteAmount: 0.5, vignetteSoftness: 0.5, grainAmount: 0.15, grainSeed: 7 },
    });
    assert.equal(await assembleAndCount(plan), 50);
    const first = fileHash(plan.output.path);
    const baseline = outputs['b'];
    assert.ok(baseline !== undefined, 'plan (b) ran first');
    const { psnr } = await compare(ffmpeg?.path ?? '', baseline, plan.output.path);
    assert.ok(psnr < 40, `PSNR against the ungraded delivery ${psnr} dB: the vignette and grain changed the picture`);
    assert.equal(await assembleAndCount(plan), 50);
    assert.equal(fileHash(plan.output.path), first, 'the second encode is byte-identical');
  });

  it('(i) plan (b) as hevc is an hevc stream of 50 square-pixel frames', async () => {
    const plan = makePlan(sources, out('i-hevc.mp4'), {
      transitions: [{ afterClipId: 'a', type: 'dissolve', frames: 10 }],
      output: { path: out('i-hevc.mp4'), codec: 'hevc', crf: 22, preset: 'fast', faststart: true },
    });
    assert.equal(await assembleAndCount(plan), 50);
    assert.equal(await probeEntry(ffprobe?.path ?? '', plan.output.path, 'codec_name'), 'hevc');
    const probed = await assembler.probeOutput(plan.output.path, 50, never);
    assert.equal(probed.sampleAspectRatio, '1:1');
    assert.equal(probed.frames, 50);
  });

  it('(j) cuts a 640x360 clip and an anamorphic (SAR 4:3) clip against the 320x180 clip into 90 square-pixel frames, letterboxing the anamorphic one', async () => {
    const plan = makePlan(sources, out('j-mixed.mp4'), {
      clips: [clip('big', 'frames', sources.largePattern), clip('ana', 'video', sources.anamorphicVideoPath), clip('b', 'frames', sources.colorPattern)],
    });
    assert.equal(await assembleAndCount(plan), 90);
    const probed = await assembler.probeOutput(plan.output.path, 90, never);
    assert.deepEqual(probed, { frames: 90, fps: 30, width: 320, height: 180, pixelFormat: 'yuv420p', colorSpace: 'bt709', sampleAspectRatio: '1:1' });
    const frame = join(dir, 'j-anamorphic.png');
    await extractFrame(ffmpeg?.path ?? '', plan.output.path, 45, frame);
    const top = await peakLuma(ffmpeg?.path ?? '', frame, '320:20:0:0');
    assert.ok(top < 40, `the widened 4:3-pixel clip is letterboxed: the top 20 rows peak at Y ${top}`);
    const middle = await peakLuma(ffmpeg?.path ?? '', frame, '320:20:0:80');
    assert.ok(middle > 100, `the picture itself is there: the middle rows peak at Y ${middle}`);
  });

  it('reads the delivery back through ffprobe with the plan size, rate, BT.709 matrix and square pixels', async () => {
    const baseline = outputs['b'];
    assert.ok(baseline !== undefined);
    const probed = await assembler.probeOutput(baseline, 50, never);
    assert.deepEqual(probed, { frames: 50, fps: 30, width: 320, height: 180, pixelFormat: 'yuv420p', colorSpace: 'bt709', sampleAspectRatio: '1:1' });
  });
});
