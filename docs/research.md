# Research log

Every external fact the design relies on, with its source and status. Status values: **verified** (read from a primary source or measured on the owner's machine on the date given), **unverified** (secondary source or not yet measured), **failed** (checked and found wrong). Measured items point at the probe report under `docs/evidence/`.

Last full pass: 2026-10-26, Windows 11 Pro, Node 24.13.0, ffmpeg 9.0.2, Edge 156.0.4314.42, Chrome 156.0.8078.47, NVIDIA RTX 2060 driver 610.88.

## Platform

| Item | Status | Finding | Source |
| --- | --- | --- | --- |
| Node type stripping default on and stable | verified | On by default since 22.18/23.6; stable since 24.12; erasable syntax only; `tsconfig.json` ignored; `.ts` under `node_modules` refused; `.ts` extension required in relative imports; `import type` required for types | [nodejs.org/api/typescript](https://nodejs.org/api/typescript.html) |
| Local Node strips types | verified | `process.features.typescript === 'strip'` on 24.13.0; `enum` throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` | local probe |
| `module.stripTypeScriptTypes` | verified | Release candidate; still emits `ExperimentalWarning` on 24.13 and 26.12; `transform` and `sourceMap` options removed in 26.0; `import type` erased to whitespace keeping line and column; `.ts` specifiers kept | [nodejs.org/api/module](https://nodejs.org/api/module.html); `docs/evidence/m0/p3-tsserve.md` |
| Node release lines | verified | 24.x Maintenance LTS from 2026-10-20 (EOL 2028-04-30); 26.x Active LTS from 2026-10-28; 25.x EOL | [nodejs/Release](https://github.com/nodejs/Release) |
| Node refuses `.cmd`/`.bat` without a shell | verified | `spawnSync('npm.cmd')` → `EINVAL`; `shell: true` → `DEP0190` | local probe |
| Windows long paths | verified | `LongPathsEnabled = 0` on the owner's machine; git has `core.longpaths=true` but that covers git only | registry |
| TypeScript flags | verified | 6.0.3 honors `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; decorators and inline type specifiers are accepted (lint catches them); TS 6/7 default `types` to `[]` | [typescriptlang.org/tsconfig](https://www.typescriptlang.org/tsconfig/); `docs/evidence/m0/p2-tsc-flags.md` |
| TypeScript 7.0.2 | verified | Native port, no programmatic compiler API yet (7.1 beta adds one); not usable for the house-rule lint | [npm typescript](https://registry.npmjs.org/typescript/latest) |
| `npm ci` time for the pinned set | verified | 8.3 s, 97 MB, 32 packages, lockfile v3 with `--ignore-scripts` on the owner's machine | measured 2026-10-26 |

## Claude Code skills and plugins

| Item | Status | Finding | Source |
| --- | --- | --- | --- |
| SKILL.md frontmatter | verified | All fields optional; only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` are portable to claude.ai and the Skills API, which reject unknown fields; keep SKILL.md under 500 lines; `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` are inline text substitutions | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills); [agentskills.io](https://agentskills.io/specification) |
| Plugin layout | verified | `.claude-plugin/plugin.json` (only `name` required; no pinned `version` unless bumped each release) plus `skills/<name>/SKILL.md`; no top-level `bin/`; installable from a git repo through `.claude-plugin/marketplace.json`; `claude --plugin-dir .` for development | [plugins reference](https://code.claude.com/docs/en/plugins-reference); [marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference); [install](https://code.claude.com/docs/en/plugins/install) |
| Dependency auto-install | verified | `package.json` + `package-lock.json` (v2/v3) at the plugin root → `npm ci --ignore-scripts`, exact registry pins only, no overrides, 60-second timeout, all-or-nothing; heavy or scripted dependencies belong in a hook or command that installs into `${CLAUDE_PLUGIN_DATA}` | [plugin loading](https://code.claude.com/docs/en/plugins/loading) |
| Local cache layout | verified | `~/.claude/plugins/cache/<marketplace>/<plugin>/<version-or-sha>/`; data under `~/.claude/plugins/data/<plugin>-<marketplace>/`; `~/.claude/skills` absent on the owner's machine | local inspection |

## Browser rendering

| Item | Status | Finding | Source |
| --- | --- | --- | --- |
| Playwright system channels | verified | playwright-core 1.64.1 (Apache-2.0); `channel: 'msedge'` / `'chrome'` launch the branded browser in new headless mode; `--user-data-dir` in `args` throws, use `launchPersistentContext` | [class BrowserType](https://playwright.dev/docs/api/class-browsertype); probes P3–P5 |
| `page.screenshot({animations: 'disabled'})` | verified | Calls `finish()` on finite animations and `cancel()`+`play()` on infinite ones: destroys a seeked frame. Measured: the seeked CSS box landed at 0 px instead of 200 px | playwright-core source; `docs/evidence/m0/p5-determinism.md` |
| `page.clock` | verified | Fakes timers, rAF, Date, performance; never `document.timeline`, so it cannot drive CSS/WAAPI | [playwright.dev/docs/clock](https://playwright.dev/docs/clock) |
| Headless-shell-only switches | verified | `--deterministic-mode`, `--enable-begin-frame-control`, `--font-render-hinting` are read only by the old `//headless` layer, not by `--headless` in Chrome/Edge | Chromium `headless/lib/browser/command_line_handler.cc`, `chrome/browser/headless/README.md` |
| Headless GPU on Windows | verified | Chromium forces SwiftShader for headless only on Linux; on this machine Edge and Chrome default to `ANGLE (NVIDIA ... Direct3D11)`; `--use-angle=swiftshader-webgl` and `d3d11-warp-webgl` select software renderers; WebGL2 and `EXT_color_buffer_float` available on all | Chromium `chrome/browser/headless/headless_mode_init.cc`; `docs/evidence/m0/p4-webgl.md` |
| SwiftShader fallback | verified | Deprecated; needs `--enable-unsafe-swiftshader` (Playwright passes it); `--disable-gpu` breaks WebGL on 130+ | [swiftshader.md](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md) |
| Same-machine determinism | verified | 10 identical hardware runs → identical pixel hashes at frames 0/15/30/59; Chrome identical to Edge; `--disable-lcd-text`, compositor flags and `--force-device-scale-factor` changed nothing; the software renderer is repeatable but differs from hardware (SSIM 0.98, PSNR 21–28 dB); WebGL canvases are captured with or without `preserveDrawingBuffer`; ~50 ms per 1080p screenshot | `docs/evidence/m0/p5-determinism.md` |
| Windows text rendering | verified | Chromium reads per-user ClearType settings (`FontSmoothing`, `FontSmoothingType`, orientation, gamma), so cross-machine byte identity is impossible | Chromium `ui/gfx/font_render_params_win.cc`; registry |
| three.js | verified | 0.186.1 (MIT); `three/addons/*` exports; `build/three.module.js` imports `./three.core.js`; addons import bare `three`; `EffectComposer.render()` without `deltaTime` uses a wall clock; `FilmPass` accumulates time; `TAARenderPass` is static-only; `PCFSoftShadowMap` deprecated in r186; `@types/three` 0.186.0 needed for typing | [unpkg three@0.186.1](https://unpkg.com/three@0.186.1/package.json) and addon sources |
| Fonts | verified | Inter and Roboto absent on the owner's machine; Segoe UI and Bahnschrift present but Microsoft-licensed; Google Fonts families are OFL under `ofl/` in google/fonts (Roboto included) and on npm as `@fontsource-variable/*` | [google/fonts](https://github.com/google/fonts); local font list |

## Blender

| Item | Status | Finding | Source |
| --- | --- | --- | --- |
| Installed version | verified | Not installed anywhere on the owner's machine (winget, PATH, registry, Store, Start menu, filesystem) | local probe |
| Current releases | verified | 5.2 LTS current stable (5.2.3 on 2026-10-22, Python 3.13); 4.5 LTS until July 2027 (Python 3.11); 5.3 beta switches the Windows default GPU backend to Vulkan | [release notes index](https://developer.blender.org/docs/release_notes/); [LTS page](https://www.blender.org/download/lts/); [5.3 EEVEE notes](https://developer.blender.org/docs/release_notes/5.3/eevee/) |
| winget package | verified | `BlenderFoundation.Blender` 5.2.3, MSI, elevates itself, SHA-256 `a103d4ec…8605` equal to `blender-5.2.3.sha256`; installs to `Program Files\Blender Foundation\Blender 5.2`; writes no install-path registry value; the blender.org download page links stale 5.2.2 checksum files | [winget manifest](https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/b/BlenderFoundation/Blender/5.2.3/BlenderFoundation.Blender.installer.yaml); [release directory](https://download.blender.org/release/Blender5.2/) |
| EEVEE engine id | verified | `BLENDER_EEVEE_NEXT` in 4.2–4.5, renamed to `BLENDER_EEVEE` in 5.0 | [5.0 Python API notes](https://developer.blender.org/docs/release_notes/5.0/python_api/) |
| Slotted actions | verified | Introduced in 4.4; legacy `action.fcurves/groups/id_root` removed in 5.0; `obj.keyframe_insert(data_path, frame=)` unchanged; `keyframe_new_interpolation_type` preference sets interpolation without touching F-Curves | [4.4 Python API notes](https://developer.blender.org/docs/release_notes/4.4/python_api/); [bpy_struct](https://docs.blender.org/api/current/bpy.types.bpy_struct.html) |
| Other 5.0 changes | verified | `ImageFormatSettings.media_type` must precede `file_format`; `scene.node_tree` → `scene.compositing_node_group`; `use_nodes` deprecated; Cycles `get_devices()` deprecated for `refresh_devices()`; background render log format changed (never parse stdout) | 5.0 notes; Cycles `properties.py` |
| Background mode on Windows | unverified (source only) | `-b` creates an offscreen WGL context on a hidden window (OpenGL) or a windowless Vulkan context; needs an interactive session; EEVEE and Workbench need the context, Cycles does not | `wm_init_exit.cc`, `wm_window.cc`, `GHOST_SystemWin32.cc`, `engine.cc` in blender-v5.2-release |
| Exit codes | unverified (source only) | Python exception → 0 unless `--python-exit-code N` precedes `-P`; render failure (`G.is_break`) → 1; some pre-render failures → 0 with no file; crash → `0xC0000005` with `%TEMP%\blender.crash.txt`; open issue #165595 reports a teardown crash after success in 5.2.3 | `creator.cc`, `creator_args.cc`, `pipeline.cc`, `creator_signals.cc`; [issue #165595](https://projects.blender.org/blender/blender/issues/165595) |
| Launcher vs executable | verified | `blender-launcher.exe` starts `blender.exe` with `CREATE_NEW_CONSOLE`; the Store build exposes only a launcher alias; spawn `blender.exe` directly | `blender_launcher_win32.c`; MSIX manifest |
| Feature probes | verified | `hasattr(bpy.types.X, 'prop')` never sees RNA properties (`#if 0` in `bpy_rna.cc`); use `'prop' in bpy.types.X.bl_rna.properties` | `bpy_rna.cc` |
| OptiX on RTX 2060 | verified | Compute capability 7.5 against a minimum of 5.0; driver 610.88 against a minimum of 575 | [requirements](https://www.blender.org/download/requirements/) |
| CLI flags | verified | `--background --factory-startup --disable-autoexec -noaudio --offline-mode --python-exit-code --gpu-backend --python`; render flags are processed left to right | [5.2 command-line arguments](https://docs.blender.org/manual/en/5.2/advanced/command_line/arguments.html) |

## Narration

| Item | Status | Finding | Source |
| --- | --- | --- | --- |
| kokoro-js | verified | 1.2.1, Apache-2.0; 24 kHz output; 28 English voices usable (`a*`/`b*`), bundled in the tarball; `from_pretrained` forwards only `dtype`, `device`, `progress_callback`; constructor is public; input clamped to 509 tokens; numbers and abbreviations need pre-normalization | [kokoro.js source](https://raw.githubusercontent.com/hexgrad/kokoro/main/kokoro.js/src/kokoro.js); [VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) |
| Dependency chain size | verified | 55 packages, 150,105,533 bytes compressed, 424,500,506 bytes unpacked on win32-x64 (onnxruntime-node 218 MB unpacked, onnxruntime-web 93 MB unused in Node) | registry tarball sizes |
| Licenses inside the chain | verified | `phonemizer` 1.2.1 embeds an Emscripten build of eSpeak NG (GPL-3.0-or-later) with unidentified corresponding source; `@img/sharp-win32-x64` bundles libvips (LGPL-3.0-or-later); `onnxruntime-node` bundles `DirectML.dll` (proprietary Microsoft license) under `bin/napi-v3/win32/x64` | [phonemizer.js issue #6](https://github.com/xenova/phonemizer.js/issues/6); unpkg listings |
| Whether DirectML.dll is loaded on the CPU path | unverified | To be checked in M6 by inspecting the process module list | — |
| transformers.js caching | verified | No hash verification; writes to the final path without rename; default cache inside `node_modules`; `env.localModelPath` + `env.allowRemoteModels = false` give an offline, fail-closed path; cache key is model id + revision + filename | [hub.js 3.8.1](https://raw.githubusercontent.com/huggingface/transformers.js/3.8.1/src/utils/hub.js) |
| Pinned weights | verified | Repo `onnx-community/Kokoro-82M-v1.0-ONNX`, commit `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, Apache-2.0; q8 `onnx/model_quantized.onnx` 92,361,116 bytes SHA-256 `fbae9257…1478`; `config.json` 44 bytes; `tokenizer.json` 3,497 bytes; `tokenizer_config.json` 113 bytes | Hugging Face API; `resolve` headers |
| Redirect host | verified | The pinned `resolve` URL answers 302 to `us.aws.cdn.hf.co`; small files are served by `huggingface.co` after a 307 | `docs/evidence/m0/p7-redirects.md` |

## Assets and network

| Item | Status | Finding | Source |
| --- | --- | --- | --- |
| Poly Haven API | verified | `/assets?t=hdris\|textures\|models`, `/files/{id}` (md5 per file), `/info/{id}`; CC0; a unique User-Agent is required and a credit is requested; no redirects on `api.polyhaven.com` or `dl.polyhaven.org` | [polyhaven.com/our-api](https://polyhaven.com/our-api); [license](https://polyhaven.com/license); `docs/evidence/m0/p7-redirects.md` |
| GitHub redirects | verified | `github.com/.../raw/...` → `raw.githubusercontent.com`; release assets → `release-assets.githubusercontent.com` | `docs/evidence/m0/p7-redirects.md` |
| Music sources | verified | None is allowlisted: freesound needs an API key; Pixabay forbids standalone redistribution; Free Music Archive and Incompetech are CC-BY. Music is user-supplied or absent | their license pages |
| GSAP license | verified | "Standard no charge" 2025 license is proprietary ("Proprietary Free") and prohibits use in no-code animation tools | [ScanCode entry](https://scancode-licensedb.aboutcode.org/gsap-standard-no-charge-2025.html) |
| Alternatives | verified | Remotion company license; Theatre.js studio AGPL-3.0; Motion Canvas MIT but stale (3.17.2, 2024-12); HyperFrames Apache-2.0 with GSAP default; blender-mcp runs arbitrary Python and integrates keyed APIs | see ADR 0003 |

## ffmpeg

| Item | Status | Finding | Source |
| --- | --- | --- | --- |
| Filters and encoders | verified | xfade (58 transitions), lut3d, loudnorm, sidechaincompress, blackdetect, freezedetect, ssim, psnr, signalstats, ebur128, tile, drawtext, scdet, noise, vignette, subtitles present; libx264, libx265, prores_ks, aac, libopus present; h264_nvenc/hevc_nvenc work on the RTX 2060, av1_nvenc does not | `docs/evidence/m0/p6-ffmpeg.md`; local `-filters`/`-encoders` |
| Filter path quoting on Windows | verified | File paths inside filter options need single quotes plus `\:` (`lut3d=file='C\:/path/x.cube'`); Git Bash additionally rewrites such arguments, Node `spawn` does not | `docs/evidence/m0/p6-ffmpeg.md` |
| Identity LUT, noise, BT.709, xfade, scdet, blackdetect, freezedetect, signalstats, tile+drawtext, ebur128, two-pass loudnorm | verified | See the probe report for numbers (identity LUT lossless; seeded noise reproducible per sequence but position-dependent, so grain is applied at assemble only; BT.709 round trip 41.6 dB PSNR; two-pass loudnorm lands on −16.0 LUFS) | `docs/evidence/m0/p6-ffmpeg.md` |

## Creative standards

| Item | Status | Finding | Source |
| --- | --- | --- | --- |
| Safe areas | verified | 93 % action, 90 % title/graphics for 16:9 HD (legacy 90/80 is outdated) | [EBU R95](https://tech.ebu.ch/publications/r095) |
| Text contrast | verified | WCAG 2.2 contrast formula, 4.5:1 for normal text, 3:1 for large | [WCAG 2.2 Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| Easing tokens | verified | CSS keywords (`ease` 0.25,0.1,0.25,1; `ease-in-out` 0.42,0,0.58,1); Material 3 standard 0.2,0,0,1, standard-decelerate 0,0,0,1, standard-accelerate 0.3,0,1,1, emphasized-accelerate 0.3,0,0.8,0.2 (emphasized-decelerate differs between Android and Flutter sources) | [CSS Easing 1](https://www.w3.org/TR/css-easing-1/); MDC-Android `tokens.xml` |
| Camera and lens model | verified | Blender: 36 mm sensor, `sensor_fit AUTO`, `aperture_fstop` 2.8, `motion_blur_shutter` 0.5; three: `filmGauge` 35 by default on the larger axis, must be 36 for parity; `BokehPass.aperture` is not an f-number | bpy docs; three `PerspectiveCamera.js`, `BokehPass.js` |
| Shot sizes, angles, moves, lighting setups | verified | Standard vocabulary (ECU…ELS; eye/low/high/dutch/overhead; dolly, truck, pedestal, crane, arc, zoom, dolly zoom, whip pan, rack focus; three-point, Rembrandt, butterfly, split, high and low key) | [StudioBinder shot guide](https://www.studiobinder.com/blog/ultimate-guide-to-camera-shots/); [camera movements](https://www.studiobinder.com/blog/different-types-of-camera-movements-in-film/); [lighting](https://www.studiobinder.com/blog/film-lighting-techniques/) |
| Higgsfield vocabulary (UX reference only) | verified | About 65 named camera presets, direction-level controls (genre, era, tempo, emotion, palette, lighting, camera look, lens look, aperture), reference-anchored consistency | [higgsfield.ai/camera-controls](https://higgsfield.ai/camera-controls) |
| Remotion determinism rules (ideas only) | verified | A frame is a pure function of the frame number; components must not depend on render order; avoid CSS animations | [remotion.dev/docs/flickering](https://www.remotion.dev/docs/flickering) |
