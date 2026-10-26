/**
 * Probe P6: does the installed ffmpeg do what the finishing and QA stages need?
 *
 * Synthetic sources only (testsrc2, color, sine). Checks: identity 3D LUT
 * through lut3d, seeded noise stability, BT.709 round trip, xfade frame
 * counts, scdet at a known cut, blackdetect/freezedetect keys, signalstats
 * values, tile + drawtext contact sheet, ebur128 and two-pass loudnorm.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EvidenceReport, compareImages, ensureDir, ffmpegPath, ffprobePath, filterPath, framehash, repoRoot, runCommand, scratchDir } from './lib.ts';

interface Step {
  readonly name: string;
  readonly result: string;
  readonly ok: boolean;
}

const ffmpeg = (): string => ffmpegPath();
const ffprobe = (): string => ffprobePath();

async function ff(args: readonly string[], timeoutMs = 180_000): Promise<{ readonly exitCode: number | null; readonly stderr: string; readonly stdout: string }> {
  const result = await runCommand(ffmpeg(), ['-hide_banner', '-y', ...args], { timeoutMs });
  return result;
}

async function frameCount(path: string): Promise<number> {
  const result = await runCommand(ffprobe(), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path]);
  return Number.parseInt(result.stdout.trim(), 10);
}

async function probeEntries(path: string, entries: string): Promise<string> {
  const result = await runCommand(ffprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'default=noprint_wrappers=1', path]);
  return result.stdout.trim().replace(/\r?\n/g, ', ');
}

/** Writes an identity 3D LUT of the given size in .cube format. */
function writeIdentityCube(path: string, size: number): void {
  const lines: string[] = ['TITLE "identity"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        lines.push(`${(r / (size - 1)).toFixed(6)} ${(g / (size - 1)).toFixed(6)} ${(b / (size - 1)).toFixed(6)}`);
      }
    }
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

/**
 * Reads one value from the ebur128 end-of-stream summary. The filter also
 * prints per-frame lines with the same labels (starting at -70 LUFS), so only
 * the text after "Summary:" is searched.
 */
function ebur128Summary(stderr: string, label: 'I' | 'Peak'): string {
  const summaryStart = stderr.lastIndexOf('Summary:');
  const summary = summaryStart >= 0 ? stderr.slice(summaryStart) : '';
  const match = new RegExp(`\\b${label}:\\s+(-?[0-9.]+) (?:LUFS|dBFS)`).exec(summary);
  return match?.[1] ?? 'n/a';
}

function metadataValues(text: string, key: string): string[] {
  const values: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = new RegExp(`${key.replace(/\./g, '\\.')}=(.*)$`).exec(line.trim());
    if (match?.[1] !== undefined) values.push(match[1].trim());
  }
  return values;
}

/** Runs the probe and writes docs/evidence/m0/p6-ffmpeg.md. */
export async function run(): Promise<void> {
  const report = new EvidenceReport('p6-ffmpeg', 'P6: ffmpeg finishing and QA filters');
  const dir = ensureDir(join(scratchDir, 'p6'));
  const version = await runCommand(ffmpeg(), ['-version']);
  report.facts({ ffmpeg: ffmpeg(), version: version.stdout.split(/\r?\n/)[0] ?? '' });
  const steps: Step[] = [];
  const srcDir = ensureDir(join(dir, 'src'));
  const srcPattern = join(srcDir, 'f%04d.png');

  // 1. Source frames: 60 frames of testsrc2 with a text overlay and gradient, 1920x1080.
  const gen = await ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=2', '-frames:v', '60', srcPattern]);
  steps.push({ name: 'generate 60 source frames (testsrc2 1080p30)', result: `exit ${gen.exitCode}, ${existsSync(join(srcDir, 'f0060.png')) ? 'f0060.png exists' : 'f0060.png missing'}`, ok: gen.exitCode === 0 && existsSync(join(srcDir, 'f0060.png')) });
  const frame1 = join(srcDir, 'f0001.png');

  // 2. Identity 33^3 LUT through lut3d tetrahedral: expect lossless.
  const cube = join(dir, 'identity.cube');
  writeIdentityCube(cube, 33);
  const lutOut = join(dir, 'lut.png');
  const lut = await ff(['-i', frame1, '-vf', `format=gbrp16le,lut3d=file=${filterPath(cube)}:interp=tetrahedral,format=rgb24`, lutOut]);
  const lutCmp = lut.exitCode === 0 ? await compareImages(frame1, lutOut) : { ssim: Number.NaN, psnr: Number.NaN };
  steps.push({ name: 'identity .cube via lut3d (gbrp16le, tetrahedral)', result: `exit ${lut.exitCode}, PSNR ${lutCmp.psnr}, SSIM ${lutCmp.ssim}`, ok: lut.exitCode === 0 && (lutCmp.psnr >= 50 || lutCmp.psnr === Number.POSITIVE_INFINITY) });

  // 3. Seeded noise: two runs over the sequence must hash identically; a frame processed alone must match its in-sequence hash for grain to be cacheable per shot.
  const noiseFilter = 'noise=all_seed=7:all_strength=12:all_flags=t+u';
  const noiseA = await ff(['-framerate', '30', '-i', srcPattern, '-vf', noiseFilter, '-f', 'framehash', '-hash', 'sha256', '-']);
  const noiseB = await ff(['-framerate', '30', '-i', srcPattern, '-vf', noiseFilter, '-f', 'framehash', '-hash', 'sha256', '-']);
  const hashLines = (text: string): string[] => text.split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith('#'));
  const seqA = hashLines(noiseA.stdout);
  const seqB = hashLines(noiseB.stdout);
  const identical = seqA.length === 60 && seqA.length === seqB.length && seqA.every((line, i) => line === seqB[i]);
  steps.push({ name: 'seeded noise: two sequence runs identical', result: `${seqA.length} frames hashed, identical=${identical}`, ok: identical });
  const frame30 = join(srcDir, 'f0030.png');
  const alone = await ff(['-i', frame30, '-vf', noiseFilter, '-f', 'framehash', '-hash', 'sha256', '-']);
  const aloneHash = hashLines(alone.stdout)[0]?.split(/,\s*/).pop() ?? '';
  const inSeqHash = seqA[29]?.split(/,\s*/).pop() ?? '';
  steps.push({ name: 'seeded noise: frame 30 alone equals frame 30 in sequence', result: `alone ${aloneHash.slice(0, 16)} vs in-sequence ${inSeqHash.slice(0, 16)}: ${aloneHash === inSeqHash ? 'same' : 'DIFFERENT (grain must be applied at assemble only)'}`, ok: true });

  // 4. BT.709 round trip: PNG sequence -> H.264 yuv420p with explicit matrix and tags -> decode frame 1 -> PSNR.
  const mp4 = join(dir, 'bt709.mp4');
  const enc = await ff(['-framerate', '30', '-i', srcPattern, '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', mp4]);
  const decoded = join(dir, 'decoded1.png');
  const dec = await ff(['-i', mp4, '-frames:v', '1', '-vf', 'format=rgb24', decoded]);
  const rt = dec.exitCode === 0 ? await compareImages(frame1, decoded) : { ssim: Number.NaN, psnr: Number.NaN };
  const tags = await probeEntries(mp4, 'stream=codec_name,pix_fmt,color_space,color_primaries,color_transfer,color_range,width,height,r_frame_rate');
  steps.push({ name: 'BT.709 round trip (libx264 CRF 16, yuv420p, tagged)', result: `encode exit ${enc.exitCode}, decode PSNR ${rt.psnr.toFixed(2)} dB, SSIM ${rt.ssim.toFixed(4)}; ${tags}`, ok: enc.exitCode === 0 && rt.psnr >= 40 });

  // 5. xfade dissolve and fadeblack: two 1 s clips with a 0.5 s transition -> 45 frames.
  for (const transition of ['dissolve', 'fadeblack']) {
    const out = join(dir, `xfade-${transition}.mp4`);
    const x = await ff(['-f', 'lavfi', '-i', 'color=c=0x2040a0:size=640x360:rate=30:duration=1', '-f', 'lavfi', '-i', 'color=c=0xa04020:size=640x360:rate=30:duration=1', '-filter_complex', `[0:v][1:v]xfade=transition=${transition}:duration=0.5:offset=0.5,format=yuv420p`, '-c:v', 'libx264', '-crf', '18', out]);
    const n = x.exitCode === 0 ? await frameCount(out) : -1;
    steps.push({ name: `xfade ${transition}: 1 s + 1 s with 0.5 s overlap`, result: `exit ${x.exitCode}, ${n} frames (expected 45)`, ok: n === 45 });
  }

  // 6. scdet at a known cut: 30 frames of one test pattern then 30 of another. Two flat colors
  //    score only 7.8 on scdet's 0-100 scale (below the default threshold of 10), so the clip cuts
  //    between two textured patterns, as real shots do.
  const cutClip = join(dir, 'cut.mp4');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1', '-f', 'lavfi', '-i', 'rgbtestsrc=size=640x360:rate=30:duration=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p', '-c:v', 'libx264', '-crf', '18', cutClip]);
  const scdetLog = join(dir, 'scdet.txt');
  const sc = await ff(['-i', cutClip, '-vf', `scdet=threshold=10,metadata=mode=print:key=lavfi.scd.time:file=${filterPath(scdetLog)}`, '-f', 'null', '-']);
  const scTimes = existsSync(scdetLog) ? metadataValues(readFileSync(scdetLog, 'utf8'), 'lavfi.scd.time') : [];
  const scoreLog = join(dir, 'scdet-scores.txt');
  await ff(['-i', cutClip, '-vf', `scdet=threshold=10,metadata=mode=print:key=lavfi.scd.score:file=${filterPath(scoreLog)}`, '-f', 'null', '-']);
  const scores = existsSync(scoreLog) ? metadataValues(readFileSync(scoreLog, 'utf8'), 'lavfi.scd.score').map((s) => Number.parseFloat(s)) : [];
  const maxScore = scores.length === 0 ? Number.NaN : Math.max(...scores);
  steps.push({ name: 'scdet detects exactly one cut at t=1.0 (threshold 10)', result: `exit ${sc.exitCode}, lavfi.scd.time values: [${scTimes.join(', ')}], max score ${maxScore.toFixed(1)}, frames with score > 0: ${scores.filter((s) => s > 0).length}`, ok: scTimes.length === 1 && Math.abs(Number.parseFloat(scTimes[0] ?? 'NaN') - 1.0) < 0.05 });

  // 7. blackdetect and freezedetect on a clip with a black hole and a frozen tail.
  const bfClip = join(dir, 'blackfreeze.mp4');
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1', '-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=30:duration=0.5', '-f', 'lavfi', '-i', 'color=c=0x808080:size=640x360:rate=30:duration=3', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p', '-c:v', 'libx264', '-crf', '18', bfClip]);
  const bd = await ff(['-i', bfClip, '-vf', 'blackdetect=d=0.2:pic_th=0.98:pix_th=0.10', '-f', 'null', '-']);
  const bdLine = bd.stderr.split(/\r?\n/).find((l) => l.includes('black_start')) ?? '(no black_start line)';
  steps.push({ name: 'blackdetect reports the 0.5 s black segment', result: bdLine.trim(), ok: bdLine.includes('black_start:1') });
  const fd = await ff(['-i', bfClip, '-vf', 'freezedetect=n=-60dB:d=1', '-f', 'null', '-']);
  const fdLine = fd.stderr.split(/\r?\n/).find((l) => l.includes('freeze_start')) ?? '(no freeze_start line)';
  steps.push({ name: 'freezedetect reports the frozen gray tail', result: fdLine.trim(), ok: fdLine.includes('freeze_start') });

  // 8. signalstats on a black frame and a mid-gray frame (limited-range Y expected: 16 and ~126).
  const statsLog = join(dir, 'signalstats.txt');
  const ss = await ff(['-f', 'lavfi', '-i', 'color=c=black:size=64x64:rate=1:duration=1', '-f', 'lavfi', '-i', 'color=c=0x808080:size=64x64:rate=1:duration=1', '-filter_complex', `[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=${filterPath(statsLog)}`, '-f', 'null', '-']);
  const yavg = existsSync(statsLog) ? metadataValues(readFileSync(statsLog, 'utf8'), 'lavfi.signalstats.YAVG') : [];
  steps.push({ name: 'signalstats YAVG for black then mid-gray (yuv420p limited range)', result: `exit ${ss.exitCode}, YAVG = [${yavg.join(', ')}]`, ok: yavg.length === 2 });

  // 9. Contact sheet: every 10th frame scaled to 320 px wide, 6x1 tile with padding, drawtext label.
  const sheet = join(dir, 'sheet.png');
  const fontFile = process.platform === 'win32' ? join(process.env['WINDIR'] ?? 'C:\\Windows', 'Fonts', 'segoeui.ttf') : '';
  const fontOption = fontFile.length > 0 && existsSync(fontFile) ? `:fontfile=${filterPath(fontFile)}` : '';
  const tile = await ff(['-framerate', '30', '-i', srcPattern, '-vf', `select='not(mod(n\\,10))',scale=320:-1,drawtext=text='shot 01 %{n}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=0x00000088${fontOption},tile=6x1:padding=4:margin=8:color=0x202020`, '-frames:v', '1', sheet]);
  const sheetDims = tile.exitCode === 0 ? await probeEntries(sheet, 'stream=width,height') : 'n/a';
  steps.push({ name: 'contact sheet via select + scale + drawtext + tile', result: `exit ${tile.exitCode}, ${sheetDims}${fontOption.length > 0 ? ' (Windows font path escaped)' : ' (default font)'}`, ok: tile.exitCode === 0 });
  if (tile.exitCode === 0) {
    const evidenceSheet = join(repoRoot, 'docs', 'evidence', 'm0', 'p6-contact-sheet.png');
    const small = await ff(['-i', sheet, '-vf', 'scale=960:-1', evidenceSheet]);
    steps.push({ name: 'contact sheet copied to docs/evidence/m0 at 960 px wide', result: `exit ${small.exitCode}`, ok: small.exitCode === 0 });
  }

  // 10. ebur128 and two-pass loudnorm on a 3 s sine tone.
  const tone = join(dir, 'tone.wav');
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-af', 'volume=-20dB', tone]);
  const eb = await ff(['-i', tone, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const integrated = ebur128Summary(eb.stderr, 'I');
  const truePeak = ebur128Summary(eb.stderr, 'Peak');
  steps.push({ name: 'ebur128 summary parse', result: `integrated ${integrated} LUFS, true peak ${truePeak} dBFS`, ok: integrated !== 'n/a' });
  const pass1 = await ff(['-i', tone, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
  const jsonStart = pass1.stderr.lastIndexOf('{');
  const jsonEnd = pass1.stderr.lastIndexOf('}');
  let measured: Record<string, string> = {};
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    measured = JSON.parse(pass1.stderr.slice(jsonStart, jsonEnd + 1)) as Record<string, string>;
  }
  const normalized = join(dir, 'normalized.wav');
  const pass2 = await ff(['-i', tone, '-af', `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured['input_i'] ?? '0'}:measured_TP=${measured['input_tp'] ?? '0'}:measured_LRA=${measured['input_lra'] ?? '0'}:measured_thresh=${measured['input_thresh'] ?? '0'}:offset=${measured['target_offset'] ?? '0'}:linear=true:print_format=summary`, '-ar', '48000', normalized]);
  const eb2 = await ff(['-i', normalized, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const integrated2 = ebur128Summary(eb2.stderr, 'I');
  steps.push({ name: 'two-pass loudnorm to -16 LUFS', result: `pass1 input_i ${measured['input_i'] ?? 'n/a'}, pass2 exit ${pass2.exitCode}, output integrated ${integrated2} LUFS`, ok: pass2.exitCode === 0 && Math.abs(Number.parseFloat(integrated2) + 16) <= 1.0 });

  // 11. Filter and encoder presence used by assemble and QA.
  const filters = await runCommand(ffmpeg(), ['-hide_banner', '-filters']);
  const encoders = await runCommand(ffmpeg(), ['-hide_banner', '-encoders']);
  const wantFilters = ['xfade', 'lut3d', 'loudnorm', 'sidechaincompress', 'blackdetect', 'freezedetect', 'ssim', 'psnr', 'signalstats', 'ebur128', 'tile', 'drawtext', 'scdet', 'noise', 'vignette', 'subtitles', 'concat', 'scale', 'format'];
  const wantEncoders = ['libx264', 'libx265', 'prores_ks', 'aac', 'libopus', 'pcm_s16le'];
  const missingFilters = wantFilters.filter((f) => !new RegExp(`\\s${f}\\s`).test(filters.stdout));
  const missingEncoders = wantEncoders.filter((e) => !new RegExp(`\\s${e}\\s`).test(encoders.stdout));
  steps.push({ name: 'required filters present', result: missingFilters.length === 0 ? wantFilters.join(', ') : `MISSING: ${missingFilters.join(', ')}`, ok: missingFilters.length === 0 });
  steps.push({ name: 'required encoders present', result: missingEncoders.length === 0 ? wantEncoders.join(', ') : `MISSING: ${missingEncoders.join(', ')}`, ok: missingEncoders.length === 0 });

  // 12. framehash of a PNG is a pixel hash (re-encoding the same pixels gives the same hash).
  const reencoded = join(dir, 'reencoded.png');
  await ff(['-i', frame1, '-compression_level', '9', reencoded]);
  const h1 = await framehash(frame1);
  const h2 = await framehash(reencoded);
  steps.push({ name: 'framehash is a pixel hash (same pixels, different PNG bytes)', result: `${h1.slice(0, 16)} vs ${h2.slice(0, 16)}: ${h1 === h2 ? 'same' : 'DIFFERENT'}`, ok: h1 === h2 });

  report.heading('Steps');
  report.table(['Step', 'Result', 'OK'], steps.map((s) => [s.name, s.result, s.ok ? 'yes' : 'NO']));
  const failures = steps.filter((s) => !s.ok);
  report.heading('Conclusion');
  report.paragraph(failures.length === 0 ? `All ${steps.length} ffmpeg checks passed.` : `${failures.length} of ${steps.length} checks failed: ${failures.map((f) => f.name).join('; ')}.`);
  report.paragraph(`Scratch output: \`${relative(repoRoot, dir)}\`.`);
  report.unverified('Timings were not measured here; the finishing chain is timed on real frames in M3.');
  report.unverified('A non-identity LUT was not evaluated against a reference grade; only the lossless path was checked.');
  const path = report.write();
  process.stdout.write(`wrote ${relative(repoRoot, path)} (${failures.length} failures)\n`);
  if (failures.length > 0) process.exitCode = 1;
}
