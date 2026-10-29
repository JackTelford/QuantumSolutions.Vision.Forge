# ADR 0007: Narration is an opt-in component installed into the data directory

Status: accepted, 2026-10-26. Owner decision recorded the same day. Amended 2026-10-29 with M6 (the voice floor and the DirectML measurement).

## Context

BUILD PROMPT v2 allows one model: Kokoro-82M through `kokoro-js` (Apache-2.0) on the CPU, optional. Research into the actual package chain found:

- `kokoro-js` 1.2.1 depends on `@huggingface/transformers` ^3.5.1 (resolves to 3.8.1), which pins `onnxruntime-node` 1.21.0 and `onnxruntime-web`, and requires `sharp`. On Windows x64 that is 55 packages, about 150 MB compressed and 425 MB unpacked.
- Claude Code installs a plugin's dependencies in one all-or-nothing `npm ci --ignore-scripts` with a 60-second timeout ([plugin loading docs](https://code.claude.com/docs/en/plugins/loading)). Below roughly 20 Mbit/s the download alone exceeds it, and a timeout would leave every lane without `node_modules`.
- `phonemizer` 1.2.1 is labelled Apache-2.0 but embeds an Emscripten build of eSpeak NG, which is GPL-3.0-or-later; its corresponding source is not identified ([issue #6](https://github.com/xenova/phonemizer.js/issues/6)). `@img/sharp-win32-x64` bundles libvips (LGPL-3.0-or-later). `onnxruntime-node` bundles `DirectML.dll`, a proprietary Microsoft redistributable, even for CPU use; whether `onnxruntime.dll` loads it in CPU mode is unverified.
- transformers.js verifies no hashes, writes downloads straight to their final path, treats any existing file as valid, and caches inside `node_modules` by default (lost on every plugin update); `KokoroTTS.from_pretrained` forwards only `dtype`, `device` and `progress_callback` ([hub.js](https://raw.githubusercontent.com/huggingface/transformers.js/3.8.1/src/utils/hub.js)).
- The model repository `onnx-community/Kokoro-82M-v1.0-ONNX` (Apache-2.0) at commit `1939ad2a8e416c0acfeecc08a694d14ef25f2231` offers a q8 model of 92,361,116 bytes (SHA-256 `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478`) plus `config.json`, `tokenizer.json` and `tokenizer_config.json`. The pinned `resolve` URL redirects to `us.aws.cdn.hf.co` (probe P7).

## Decision

- `kokoro-js` is **not** a dependency of the plugin. `components/narration/package.json` and its lockfile (exact pins: `kokoro-js` 1.2.1 and a direct `@huggingface/transformers` 3.8.1 so the plugin and kokoro-js share one `env` instance) are a template.
- `node scripts/cli.ts audio install --data-dir <dir>` copies the template into `<data>/narration/`, runs `npm ci --ignore-scripts` by spawning `node.exe` with `npm-cli.js` (never `npm.cmd`), and downloads the four pinned files with our own downloader (commit SHA, byte size, SHA-256, `.download` partial with Range resume, rename on success, provenance JSON, license copy). Requires the user's confirmation; prints the sizes first.
- The loader imports both packages from `<data>/narration/node_modules`, sets `env.localModelPath` and `env.cacheDir` to `<data>/narration/models`, `env.allowRemoteModels = false`, and calls `from_pretrained` with `dtype: 'q8'`, `device: 'cpu'`. A missing file fails closed with a hint naming `audio install`.
- `THIRD-PARTY.md` lists eSpeak NG (GPL-3.0-or-later, provenance gap stated), libvips (LGPL-3.0-or-later) and DirectML.dll (proprietary; installed, not used on the CPU path). M6 measured it: after a synthesis, with the onnxruntime sessions alive, Node's diagnostic report lists 55 mapped libraries, onnxruntime.dll and onnxruntime_binding.node among them and DirectML.dll absent (`src/audio/directml-check.ts`; `audio synth` records `directMlMapped` in narration.json on every run).
- Text normalization (numbers, units, abbreviations) and sentence chunking happen in TypeScript before synthesis. Only English voices graded B or better are offered, and B- when fewer than six reach B (kokoro-js 1.2.1 grades only `af_heart` A and `af_bella` A- at B or above, so the floor is B- and four voices are offered: `af_heart`, `af_bella`, `af_nicole`, `bf_emma`); `af_heart` is the default. Loudness is normalized in two passes to −16 LUFS, true peak −1.5 dBTP. Audio QA compares durations and `ebur128` numbers, never byte hashes.
- For narrated pieces, audio is produced before shot durations are locked, because sentence lengths are the clock of an explainer.

## Consequences

- The plugin root carries only Apache-2.0 and MIT packages; the license tension is confined to a component the user installs knowingly.
- The pipeline works without narration; users can supply their own recordings instead.
