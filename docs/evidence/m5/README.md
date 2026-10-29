# M5 evidence: the blender lane

Measured on the owner's machine on 2026-10-29: Windows 11, Node v24.13.0, Blender 5.2.3 LTS (Python 3.13.13) at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, NVIDIA GeForce RTX 2060 (driver 610.88; CUDA and OptiX devices, the i7-9700K as the CPU device), ffmpeg 9.0.2 (Gyan full build), Microsoft Edge 156 for the html and three columns of the lookdev sheet, an interactive desktop session. Every file was written by a probe (`node scripts/probes/run.ts m5-<name>` with `VF_PROBE_DATA_DIR` naming a scratch data directory where `doctor` and `assets --fetch hdri:studio_small_09-1k` had run) except the two hand-written logs named below; nothing in a generated file was edited by hand. The files beside this one:

| File | What it is |
| --- | --- |
| `acceptance.md` | the `--version` line, the probe's engine list and devices, one-frame renders of the fixture bottle through EEVEE/OpenGL, EEVEE/Vulkan and Cycles/OptiX with timings, the non-black and crash-log checks, the exit-code matrix with every argv and stderr tail, the still, render and turntable runs through the CLI, and the quality assessment; `m5-acceptance` |
| `s01-f104-*-480x270.png` | the three one-frame renders (raw, no grade) |
| `still-s01-1920x1080-960.png` | the 1080p still the `still` command made of s01 (EEVEE on OpenGL, graded), reduced to 960 px |
| `clip-s01-480x270.png`, `turntable-s02-480x270.png` | contact sheets of the 30-frame push-in (every frame) and the 150-frame turntable (every fifth frame) rendered by `render` |
| `calibration.md` | the calibration scene of ADR 0008 rendered by Blender under both view transforms with Cycles on OptiX and EEVEE on OpenGL (and Cycles under the flat world), every patch's YAVG and mean RGB, every swatch's hue turn; `m5-calibration` |
| `calibration-tuning.md` | how `blenderKeyPowerW` was set, trial by trial (hand-written from the trials) |
| `calibration-blender-*-1920x1080-640.png` | the four 1080p calibration frames reduced to 640 px |
| `lookdev.md`, `lookdev-sheet.png` | the seven looks in three columns (html, three, blender; 21 stills at 960x540, graded), each still's YAVG against the look's band, one sentence per Blender still, the three-against-blender comparison with numbers; `m5-lookdev` |
| `README.md` | this file (hand-written) |

## Acceptance (ADR 0004)

| Check | Result |
| --- | --- |
| `blender --version` | `Blender 5.2.3 LTS` |
| engines before the add-on | `BLENDER_EEVEE` only; the applier enables Cycles after `read_factory_settings(use_empty=True)` |
| devices | RTX 2060 as CUDA and OPTIX, i7-9700K as CPU; compute types NONE, CUDA, OPTIX, HIP, ONEAPI |
| EEVEE on OpenGL, one 480x270 frame | exit 0, 3.7 s, YAVG 39.2, non-black, no crash log |
| EEVEE on Vulkan | exit 0, 3.6 s warm (10.6 s on its first run of the day, the backend's shader compile), YAVG 39.2 |
| Cycles on OptiX | exit 0, 3.5 s, YAVG 39.9 |
| exit 3 | a scene path that is not JSON (`json.load` raises) and a frames directory that is a file (`bpy.ops.render.render` raises a RuntimeError): both exit 3 through `--python-exit-code 3`, judged `blender-script` with the traceback's tail |
| exit 1 | only Blender refusing a missing `.blend` file on its command line, outside the applier's argv; a render failure inside the applier is a Python exception, so no exit 1 could be provoked through the lane |
| teardown crash 0xC0000005 | not seen in any of this day's runs (every exit was 0); the predicate's tolerance for it is tested with the fake runner only |
| crash log | `%TEMP%\blender.crash.txt` was not written by any run |

## The lane end to end

Two jobs written the way `plan` writes them (`writeProbeJob` in `scripts/probes/m5-support.ts`), then the production commands as child processes (`render` with `--force`, so a re-run of the probe renders instead of reusing a complete manifest under the same key):

| Step | Result |
| --- | --- |
| `still --shot s01` at 1920x1080 | 6.9 s wall clock; the ladder's first rung (EEVEE on OpenGL, 128 samples, denoised) rendered and was pinned; gate passed (composition ok, no text, exposure 37.1 inside 24 to 140) |
| `still` at 480x270 for s01 and s02 | 4.9 s and 5.0 s, EEVEE on OpenGL pinned |
| `render --shot s01 --force` (30 frames) | 15.6 s wall clock, 14.7 s in the shot, 490 ms per frame including Blender's start per batch and the hashing (two processes: the three-frame estimate batch and one of twenty-seven); 30 distinct frame hashes |
| `render --shot s02 --force` (150-frame turntable) | 60.8 s wall clock, 59.9 s in the shot, 399 ms per frame over six Blender processes (the three-frame estimate batch, four batches of thirty and one of twenty-seven); the estimate batch projected 213 s for the rest (a ceiling, as designed: the first batch carries Blender's start), the rest took about 56 s; 150 distinct frame hashes |

## Calibration (ADR 0008 decision 2)

The gray card at 18 W (`blenderKeyPowerW`, one value for both view transforms; the handed-over 150 W read 195 and clipped):

| Render | Gray card YAVG (target 117.3 ± 5) | Mean RGB of the card | White | Black |
| --- | --- | --- | --- | --- |
| Cycles OptiX agx, studio HDRI | 118.3 | 119, 119, 119 | 177.4 | 56.2 |
| Cycles OptiX standard, studio HDRI | 118.3 | 119, 119, 119 | 213.3 | 61.5 |
| EEVEE OpenGL agx, studio HDRI | 115.7 | 116, 116, 116 | 175.9 | 54.5 |
| EEVEE OpenGL standard, studio HDRI | 115.7 | 116, 116, 116 | 208.8 | 59.9 |
| Cycles OptiX agx, flat world | 115.4 | 116, 116, 116 | 175.5 | 54.8 |
| Cycles OptiX standard, flat world | 115.5 | 116, 116, 116 | 207.7 | 60.2 |

The three lane under the same rig and HDRI reads 116.6 / 117.2 on the card, 173 / 211 on the white and 57 / 61 on the black (M4), so the two 3D lanes agree on every neutral patch within 4 code values.

## Lookdev

`lookdev-sheet.png` adds the Blender column to the M4 sheet. Every Blender still is darker than its three counterpart by 0.9 to 9.0 YAVG (the shadows Blender renders from every light and the bottle's lower half falling off under the key; the gray cards agree within 3), and the two Blender stills outside their look's band are the two three stills outside it (studio-clean 163.5 against 170 to 200, sunset-gradient 42.3 against 100 to 140), the owner's question from M4. A 960x540 Cycles still at 64 samples, denoised, costs 4.0 to 4.5 s including Blender's start.
