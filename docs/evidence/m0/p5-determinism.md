# P5: seek-based capture determinism

Generated 2026-10-26T20:17:50.041Z by `node scripts/probes/run.ts p5-determinism`.

| Fact | Value |
| --- | --- |
| platform | win32 x64 |
| node | v24.13.0 |
| v8 | 13.6.233.17-node.37 |
| cpuCount | 8 |
| timestamp | 2026-10-26T20:17:50.044Z |
| gpu | NVIDIA GeForce RTX 2060, 610.88, 6144 MiB |
| appliedDpi | 0x78 |
| FontSmoothing | 2 |
| FontSmoothingType | 0x2 |
| FontSmoothingOrientation | 0x1 |
| FontSmoothingGamma | 0x0 |
| longPathsEnabled | 0x0 |

Primary channel msedge 156.0.4314.42. Each run is a fresh persistent context (headless, 1920x1080, DPR 1). Frames 0, 15, 30, 59 at 30 fps. Expected CSS box left edge per frame: 0:0.0px, 15:200.0px, 30:400.0px, 59:786.7px.

## Runs

| Run | Launch to first frame | Renderer | DPR | fonts.status | getAnimations().length |
| --- | --- | --- | --- | --- | --- |
| A-hardware-1 | 2785 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-2 | 2609 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-3 | 2863 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-4 | 2516 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-5 | 2559 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-6 | 2474 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-7 | 2467 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-8 | 2441 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-9 | 2617 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| A-hardware-10 | 3787 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| D-text-flags-1 | 2543 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| D-text-flags-2 | 2776 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| D-text-flags-3 | 2560 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| F-compositor-flags-1 | 2687 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| F-compositor-flags-2 | 2972 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| F-compositor-flags-3 | 2666 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| E-software-1 | 2580 ms | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 1 | loaded | 2 |
| E-software-2 | 3504 ms | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 1 | loaded | 2 |
| E-software-3 | 4934 ms | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 1 | loaded | 2 |
| H-no-force-dsf-1 | 2902 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| X-animations-disabled-1 | 2348 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| S-chrome-1 | 4350 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| S-chrome-2 | 4427 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |
| S-chrome-3 | 6498 ms | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | 1 | loaded | 2 |

## Pixel hashes (ffmpeg framehash sha256, first 16 hex)

| Run | k=0 | k=15 | k=30 | k=59 | median screenshot ms |
| --- | --- | --- | --- | --- | --- |
| A-hardware-1 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 48.4 |
| A-hardware-2 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 57.5 |
| A-hardware-3 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 72.0 |
| A-hardware-4 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 50.5 |
| A-hardware-5 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 71.2 |
| A-hardware-6 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 47.1 |
| A-hardware-7 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 48.3 |
| A-hardware-8 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 45.2 |
| A-hardware-9 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 48.1 |
| A-hardware-10 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 52.9 |
| D-text-flags-1 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 52.5 |
| D-text-flags-2 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 49.6 |
| D-text-flags-3 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 71.5 |
| F-compositor-flags-1 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 51.2 |
| F-compositor-flags-2 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 77.9 |
| F-compositor-flags-3 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 49.7 |
| E-software-1 | b19055deb5a6f8a5 | dc55f732645bc6bd | cced7629cf30d46c | 902f9fe9b72668d6 | 93.5 |
| E-software-2 | b19055deb5a6f8a5 | dc55f732645bc6bd | cced7629cf30d46c | 902f9fe9b72668d6 | 82.0 |
| E-software-3 | b19055deb5a6f8a5 | dc55f732645bc6bd | cced7629cf30d46c | 902f9fe9b72668d6 | 78.4 |
| H-no-force-dsf-1 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 50.3 |
| X-animations-disabled-1 | 49d42cad2e9b409a | ad55123caea89788 | 98f5f078b36a4414 | cc85007e3c509782 | 48.5 |
| S-chrome-1 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 55.5 |
| S-chrome-2 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 66.8 |
| S-chrome-3 | 1dff246d5b226b36 | 67c21db1da27fa86 | bb20645ca639c441 | 9d5dea683b12c248 | 77.3 |

## Repeatability per flag set

| Flag set | Runs | k=0 | k=15 | k=30 | k=59 |
| --- | --- | --- | --- | --- | --- |
| A-hardware | 10 | 1 distinct / 10 | 1 distinct / 10 | 1 distinct / 10 | 1 distinct / 10 |
| D-text-flags | 3 | 1 distinct / 3 | 1 distinct / 3 | 1 distinct / 3 | 1 distinct / 3 |
| F-compositor-flags | 3 | 1 distinct / 3 | 1 distinct / 3 | 1 distinct / 3 | 1 distinct / 3 |
| E-software | 3 | 1 distinct / 3 | 1 distinct / 3 | 1 distinct / 3 | 1 distinct / 3 |
| S-chrome | 3 | 1 distinct / 3 | 1 distinct / 3 | 1 distinct / 3 | 1 distinct / 3 |

## Each flag set versus A-hardware-1

| Run | k | Hash | SSIM | PSNR dB |
| --- | --- | --- | --- | --- |
| D-text-flags-1 | 0 | identical |  |  |
| D-text-flags-1 | 15 | identical |  |  |
| D-text-flags-1 | 30 | identical |  |  |
| D-text-flags-1 | 59 | identical |  |  |
| F-compositor-flags-1 | 0 | identical |  |  |
| F-compositor-flags-1 | 15 | identical |  |  |
| F-compositor-flags-1 | 30 | identical |  |  |
| F-compositor-flags-1 | 59 | identical |  |  |
| E-software-1 | 0 | different | 0.98207 | 27.70 |
| E-software-1 | 15 | different | 0.98010 | 26.59 |
| E-software-1 | 30 | different | 0.98004 | 25.57 |
| E-software-1 | 59 | different | 0.97961 | 21.42 |
| H-no-force-dsf-1 | 0 | identical |  |  |
| H-no-force-dsf-1 | 15 | identical |  |  |
| H-no-force-dsf-1 | 30 | identical |  |  |
| H-no-force-dsf-1 | 59 | identical |  |  |
| X-animations-disabled-1 | 0 | different | 0.99487 | 27.72 |
| X-animations-disabled-1 | 15 | different | 0.99158 | 24.06 |
| X-animations-disabled-1 | 30 | different | 0.99355 | 26.92 |
| X-animations-disabled-1 | 59 | different | 0.99663 | 34.25 |
| S-chrome-1 | 0 | identical |  |  |
| S-chrome-1 | 15 | identical |  |  |
| S-chrome-1 | 30 | identical |  |  |
| S-chrome-1 | 59 | identical |  |  |

## Seek semantics on A-hardware-1 (and the animations:disabled control)

| Run | k | computed transform | rect.left | expected left | pixel left | WAAPI opacity | gl1 pixel (preserve off) | gl2 pixel (preserve on) | expected clear RGB | DPR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-hardware-1 | 0 | matrix(1, 0, 0, 1, 0, 0) | 0 | 0.0 px | 0 px | 1 | 0,51,102 | 0,51,102 | 0,51,102 | 1 |
| A-hardware-1 | 15 | matrix(1, 0, 0, 1, 200, 0) | 200 | 200.0 px | 200 px | 0.75 | 64,51,102 | 64,51,102 | 64,51,102 | 1 |
| A-hardware-1 | 30 | matrix(1, 0, 0, 1, 400, 0) | 400 | 400.0 px | 400 px | 0.5 | 127,51,102 | 127,51,102 | 128,51,102 | 1 |
| A-hardware-1 | 59 | matrix(1, 0, 0, 1, 786.667, 0) | 786.6666870117188 | 786.7 px | 786 px | 0.0166667 | 251,51,102 | 251,51,102 | 251,51,102 | 1 |
| X-animations-disabled-1 | 0 | matrix(1, 0, 0, 1, 0, 0) | 0 | 0.0 px | 0 px | 1 | 0,51,102 | 0,51,102 | 0,51,102 | 1 |
| X-animations-disabled-1 | 15 | matrix(1, 0, 0, 1, 200, 0) | 200 | 200.0 px | 0 px | 0.75 | 64,51,102 | 64,51,102 | 64,51,102 | 1 |
| X-animations-disabled-1 | 30 | matrix(1, 0, 0, 1, 400, 0) | 400 | 400.0 px | 0 px | 0.5 | 127,51,102 | 127,51,102 | 128,51,102 | 1 |
| X-animations-disabled-1 | 59 | matrix(1, 0, 0, 1, 786.667, 0) | 786.6666870117188 | 786.7 px | 0 px | 0.0166667 | 251,51,102 | 251,51,102 | 251,51,102 | 1 |
| H-no-force-dsf-1 | 0 | matrix(1, 0, 0, 1, 0, 0) | 0 | 0.0 px | 0 px | 1 | 0,51,102 | 0,51,102 | 0,51,102 | 1 |
| H-no-force-dsf-1 | 15 | matrix(1, 0, 0, 1, 200, 0) | 200 | 200.0 px | 200 px | 0.75 | 64,51,102 | 64,51,102 | 64,51,102 | 1 |
| H-no-force-dsf-1 | 30 | matrix(1, 0, 0, 1, 400, 0) | 400 | 400.0 px | 400 px | 0.5 | 127,51,102 | 127,51,102 | 128,51,102 | 1 |
| H-no-force-dsf-1 | 59 | matrix(1, 0, 0, 1, 786.667, 0) | 786.6666870117188 | 786.7 px | 786 px | 0.0166667 | 251,51,102 | 251,51,102 | 251,51,102 | 1 |

## Screenshot timing

| Flag set | median ms per 1080p screenshot | projected 600 frames (s) | projected 1800 frames (s) |
| --- | --- | --- | --- |
| A-hardware | 50.8 | 30.5 | 91.4 |
| D-text-flags | 51.0 | 30.6 | 91.8 |
| F-compositor-flags | 52.3 | 31.4 | 94.1 |
| E-software | 82.0 | 49.2 | 147.5 |
| H-no-force-dsf | 50.3 | 30.2 | 90.6 |
| X-animations-disabled | 48.5 | 29.1 | 87.2 |
| S-chrome | 64.7 | 38.8 | 116.4 |

## Conclusion

All hardware runs with identical flags produced identical pixel hashes for every frame: same-machine, same-fingerprint byte identity holds for this page.

Compositor check at k=15: expected CSS box left 200.0 px, measured 200 px from pixels; computed transform matrix(1, 0, 0, 1, 200, 0).

WebGL canvases at k=15: preserveDrawingBuffer:false sampled 64,51,102, preserveDrawingBuffer:true sampled 64,51,102 (expected clear color 64,51,102 for both).

Frames and profiles: `.tmp\p5`; reduced k=15 frames under `docs/evidence/m0/p5/`.

## Not verified

- Cross-machine identity is out of scope by design; only same-machine runs were compared.
- Three.js post-processing cost is not measured here; only the screenshot path.
