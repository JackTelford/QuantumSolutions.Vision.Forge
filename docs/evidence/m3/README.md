# M3 evidence: the html lane, the harness and the still gate

Measured on the owner's machine on 2026-10-29: Windows 11, Node v24.13.0, ffmpeg 9.0.2 (Gyan full build), Microsoft Edge 156.0.4314.50 and Google Chrome 156.0.8078.48, NVIDIA GeForce RTX 2060 (driver 610.88), AppliedDPI 120 (125 percent scaling), ClearType on. The commands are the ones the skill runs; nothing was edited by hand.

## The first rendered frame

`title-card-s03-r1-640.png` is the first still the pipeline produced (reduced to 640 px wide): shot `s03` of the reference fixture (`tests/plan/fixtures.ts`, the obsidian look, an MCU at 85 mm on `thirds-right` with the title "Now in 500 ml" at `thirds-left`), rendered by `still` at 1920x1080 and graded by the look's LUT and vignette. The gold bottle stand-in's centre sits at x = 0.667 of the frame width with 10 percent headroom; the Playfair Display title, fitted from the 140 px scale size to 115 px so it stays on one line inside its box, sits bottom-left.

```
node scripts/cli.ts doctor --data-dir <data> --skip-blender-probe
node scripts/cli.ts plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json --data-dir <data> --out <out>
node scripts/cli.ts still --job <out>/d2e1fe55 --shot s03 --data-dir <data> --out <out>
node scripts/cli.ts still --job <out>/d2e1fe55 --shot s03 --approve --data-dir <data> --out <out>
node scripts/cli.ts render --job <out>/d2e1fe55 --shot s03 --data-dir <data> --out <out>
node scripts/cli.ts plan ... (again, over the same folder)
```

| Step | Result |
| --- | --- |
| `still` | 4.1 s wall clock for one 1080p frame including the browser launch; renderer hardware (chromium, d3d11); gate passed: composition 0 problems, text-contrast 11.23:1 (box luma 62.4) against 4.5, exposure YAVG 33.4 inside 24 to 140 |
| `render` | 120 frames in 14.0 s, 118 ms per frame (screenshot plus framehash), 1 frame reused from the still; manifest complete with 120 pixel hashes and the fingerprint below |
| `plan` again | "shot s03 keeps the render profile the still gate pinned"; 3 of 3 shots keep their status; s03 stays `rendered` under the same key |

Manifest fingerprint: browser msedge 156.0.4314.50 with args `--force-device-scale-factor=1 --disable-lcd-text --use-angle=d3d11`, webglRenderer `ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11)`, appliedDpi 120, clearType { fontSmoothing 2, fontSmoothingType 2, orientation 1, gamma 0 }, node v24.13.0, ffmpeg 9.0.2.

## Determinism (ADR 0006 decision 6)

`tests/render/determinism.integration.test.ts` renders frames 0, 26, 60 and 119 of the same shot at 480x270 in ten fresh persistent-context launches (a new profile each time) and hashes the decoded pixels with ffmpeg `framehash`:

| Run | k=0 | k=26 | k=60 | k=119 | launch to last frame (ms) | screenshot ms per frame |
| --- | --- | --- | --- | --- | --- | --- |
| run-1 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1164 | 168, 42, 22, 35 |
| run-2 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1273 | 158, 27, 24, 22 |
| run-3 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1060 | 146, 22, 24, 24 |
| run-4 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1137 | 40, 25, 23, 23 |
| run-5 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1226 | 53, 25, 33, 23 |
| run-6 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1148 | 130, 34, 21, 22 |
| run-7 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1188 | 155, 38, 25, 24 |
| run-8 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1141 | 148, 21, 22, 24 |
| run-9 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1253 | 159, 34, 22, 27 |
| run-10 | 42fe01f2f60c13dd | a6642cd257af0c14 | 32d614829e55d905 | 25e4120bd5d648b1 | 1111 | 149, 27, 24, 25 |

Every frame has one hash across the ten runs (first 16 hex characters shown). The same test on Chrome (`VF_TEST_BROWSER=chrome`, three runs) gave the same four hashes, and Chrome's frame 26 scored SSIM 1.00000 against the Edge golden.

## Golden (ADR 0006 decision 7)

`tests/goldens/html/title-card-480x270-f026.png` is frame 26 of run 1 above; its sidecar `title-card-480x270-f026.fingerprint.json` records platform win32, channel msedge, browser major 156, the renderer string and the launch args. The test compares a fresh render by SSIM: 0.99 or more when the sidecar matches this machine's fingerprint, 0.95 or more otherwise (with the difference named in the test output). `VF_UPDATE_GOLDENS=1` rewrites both files.

## Timing

`render` over a 600-frame html shot at 1920x1080 (the fixture's `s03` lengthened to 600 frames, brief 26 s): 600 frames in 66.1 s, 110.2 ms per frame including the ffmpeg framehash batches of 30, one browser launch. The P5 probe's 50 ms screenshot is about half of that; the rest is the page's style writes, the PNG encode of a 1080p frame and hashing. 1800 frames (one minute at 30 fps) project to about 3.3 minutes.

## ffmpeg 7.0.2

The ffmpeg-dependent M3 suites (`tests/render/framehash`, `finish-still`, `still-gate`, `render-shot`, `tests/cli/still`, `tests/cli/render`) pass on the Gyan ffmpeg 7.0.2 full build as well as on 9.0.2: 43 tests, 0 failures.

## Not verified

- Linux and macOS: the harness has only run on Windows here; the ubuntu CI job runs the same integration tests on Chrome (Edge times out at launch there, so the tests prefer Chrome on Linux).
- The software renderer (`--renderer software`, SwiftShader) is launched and classified by the harness tests, but no golden was recorded for it.
- The three lane: the runtime refuses it with "the three lane arrives in M4".
