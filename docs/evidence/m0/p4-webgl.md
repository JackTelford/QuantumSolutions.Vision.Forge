# P4: headless WebGL renderer matrix

Generated 2026-10-26T20:10:06.708Z by `node scripts/probes/run.ts p4-webgl`.

| Fact | Value |
| --- | --- |
| platform | win32 x64 |
| node | v24.13.0 |
| v8 | 13.6.233.17-node.37 |
| cpuCount | 8 |
| timestamp | 2026-10-26T20:10:06.709Z |
| gpu | NVIDIA GeForce RTX 2060, 610.88, 6144 MiB |
| appliedDpi | 0x78 |
| FontSmoothing | 2 |
| FontSmoothingType | 0x2 |
| FontSmoothingOrientation | 0x1 |
| FontSmoothingGamma | 0x0 |
| longPathsEnabled | 0x0 |

Launch: `chromium.launchPersistentContext` on the system channel, headless, viewport 1920x1080, deviceScaleFactor 1, args ["--force-device-scale-factor=1"] plus the variant. Playwright adds `--force-color-profile=srgb`, `--hide-scrollbars` and `--enable-unsafe-swiftshader` itself.

## Renderer matrix

| Channel | Version | Variant | Context | UNMASKED_RENDERER_WEBGL | WebGL2 | EXT_color_buffer_float | OES_texture_float_linear | MAX_TEXTURE_SIZE | First frame / launch | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| msedge | 156.0.4314.42 | default | ok | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | yes | yes | yes | 16384 | 117.6 ms / launch 1361 ms | hardware |
| msedge | 156.0.4314.42 | d3d11 | ok | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | yes | yes | yes | 16384 | 98.7 ms / launch 650 ms | hardware |
| msedge | 156.0.4314.42 | swiftshader-webgl | ok | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | yes | yes | yes | 8192 | 15.5 ms / launch 541 ms | software |
| msedge | 156.0.4314.42 | d3d11-warp-webgl | ok | ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11) | yes | yes | yes | 16384 | 24.7 ms / launch 510 ms | software |
| chrome | 156.0.8078.47 | default | ok | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | yes | yes | yes | 16384 | 37.0 ms / launch 1391 ms | hardware |
| chrome | 156.0.8078.47 | d3d11 | ok | ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11) | yes | yes | yes | 16384 | 46.5 ms / launch 438 ms | hardware |
| chrome | 156.0.8078.47 | swiftshader-webgl | ok | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | yes | yes | yes | 8192 | 25.2 ms / launch 464 ms | software |
| chrome | 156.0.8078.47 | d3d11-warp-webgl | ok | ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11) | yes | yes | yes | 16384 | 10.8 ms / launch 381 ms | software |

## Conclusion

msedge: default renderer is "ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11)" (hardware).

chrome: default renderer is "ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11)" (hardware).

Hardware rendering is available: msedge/default, msedge/d3d11, chrome/default, chrome/d3d11. The harness should pass an explicit `--use-angle=d3d11` for the hardware policy and `--use-angle=swiftshader-webgl` for the software policy, and verify the renderer string at startup.

## Not verified

- Rendering throughput at 1080p with SSAA and post-processing was not measured here (P5 measures screenshot time; the three lane measures its own frame time in M4).
