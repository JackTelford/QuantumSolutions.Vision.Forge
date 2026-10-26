# P6: ffmpeg finishing and QA filters

Generated 2026-10-26T20:20:32.853Z by `node scripts/probes/run.ts p6-ffmpeg`.

| Fact | Value |
| --- | --- |
| ffmpeg | C:\Users\wipke\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe |
| version | ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers |

## Steps

| Step | Result | OK |
| --- | --- | --- |
| generate 60 source frames (testsrc2 1080p30) | exit 0, f0060.png exists | yes |
| identity .cube via lut3d (gbrp16le, tetrahedral) | exit 0, PSNR Infinity, SSIM 1 | yes |
| seeded noise: two sequence runs identical | 60 frames hashed, identical=true | yes |
| seeded noise: frame 30 alone equals frame 30 in sequence | alone 1affa276f4803078 vs in-sequence 91b3fa6cb74a68f9: DIFFERENT (grain must be applied at assemble only) | yes |
| BT.709 round trip (libx264 CRF 16, yuv420p, tagged) | encode exit 0, decode PSNR 41.59 dB, SSIM 0.9898; codec_name=h264, width=1920, height=1080, pix_fmt=yuv420p, color_range=tv, color_space=bt709, color_transfer=unknown, color_primaries=unknown, r_frame_rate=30/1 | yes |
| xfade dissolve: 1 s + 1 s with 0.5 s overlap | exit 0, 45 frames (expected 45) | yes |
| xfade fadeblack: 1 s + 1 s with 0.5 s overlap | exit 0, 45 frames (expected 45) | yes |
| scdet detects exactly one cut at t=1.0 (threshold 10) | exit 0, lavfi.scd.time values: [1], max score 30.7, frames with score > 0: 30 | yes |
| blackdetect reports the 0.5 s black segment | [Parsed_blackdetect_0 @ 000002400441d5c0] black_start:1 black_end:1.5 black_duration:0.5 | yes |
| freezedetect reports the frozen gray tail | [Parsed_freezedetect_0 @ 00000242585e7f00] lavfi.freezedetect.freeze_start: 1.5 | yes |
| signalstats YAVG for black then mid-gray (yuv420p limited range) | exit 0, YAVG = [16, 126] | yes |
| contact sheet via select + scale + drawtext + tile | exit 0, width=1956, height=196 (Windows font path escaped) | yes |
| contact sheet copied to docs/evidence/m0 at 960 px wide | exit 0 | yes |
| ebur128 summary parse | integrated -41.8 LUFS, true peak -38.1 dBFS | yes |
| two-pass loudnorm to -16 LUFS | pass1 input_i -41.75, pass2 exit 0, output integrated -16.0 LUFS | yes |
| required filters present | xfade, lut3d, loudnorm, sidechaincompress, blackdetect, freezedetect, ssim, psnr, signalstats, ebur128, tile, drawtext, scdet, noise, vignette, subtitles, concat, scale, format | yes |
| required encoders present | libx264, libx265, prores_ks, aac, libopus, pcm_s16le | yes |
| framehash is a pixel hash (same pixels, different PNG bytes) | b136ce5d0ee1f95c vs b136ce5d0ee1f95c: same | yes |

## Conclusion

All 18 ffmpeg checks passed.

Scratch output: `.tmp\p6`.

## Not verified

- Timings were not measured here; the finishing chain is timed on real frames in M3.
- A non-identity LUT was not evaluated against a reference grade; only the lossless path was checked.
