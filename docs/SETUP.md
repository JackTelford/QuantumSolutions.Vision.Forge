# Set up Vision.Forge on a new PC

## Quick start

1. Use Windows 11 (first class), macOS or Linux with a GPU driver installed. Allow about 1 GB of disk for the programs below plus render output; 16 GB RAM is recommended. An NVIDIA, AMD or Intel GPU makes the `three` lane and EEVEE fast; everything still runs on software rendering, slower.
2. Clone this repository into a short path such as `C:\Code\QuantumSolutions.Vision.Forge`. Windows limits paths to 260 characters unless long paths are enabled, and render output lives under short job folders to stay inside that limit.
3. Run `Setup-VisionForge.cmd`. It prints a table of the programs below with the exact install command under each missing one, installs them only with `-Install` (add `-SkipBlender` to leave Blender out), and when every required program is present runs `npm ci --ignore-scripts` and `node scripts\cli.ts doctor`. `-CheckOnly` prints the table and stops with exit code 0 or 1. It never asks for input. On macOS and Linux run `scripts/setup.sh` with `--install`, `--skip-blender` or `--check-only`; there `--install` calls `sudo`, which may ask for your password.
4. Run `node scripts\cli.ts doctor` whenever a program changes. Exit code 0 means every required program was found; the output lists which lanes (`html`, `three`, `blender`, `audio`) are available, and `tools.json` under the data directory records every path and version.

To install by hand instead, use the commands below and run `npm ci --ignore-scripts` in the clone.

## What comes with this repository

| Included | Purpose |
| --- | --- |
| TypeScript source under `scripts/` and `src/` | the command-line program, the render harness and the shared camera, timeline and composition code |
| `blender/apply_scene.py` | the one Python file Blender runs; it applies a resolved scene and makes no decisions |
| `skills/cinematic-studio/` | the Claude Code skill, its creative knowledge base, bundled OFL fonts and CC0 HDRIs (from M3) |
| `schemas/` | JSON Schema contracts for every document the pipeline exchanges, and `vocabulary.json` with every shared enumeration |
| `docs/` | decisions (`adr/`), research with sources, probe evidence with numbers, this guide, the handoff log |
| `package.json` and `package-lock.json` | exact dependency pins; `npm ci` installs them |

The clone contains no ffmpeg, no Blender, no browser, no model weights and no rendered media.

## What is installed separately and why

GitHub refuses ordinary files larger than 100 MiB, and the project rule is to call ffmpeg and Blender as external programs rather than bundle them. Blender's installer alone is about 350 MB. Keeping them outside the repository keeps clones small and lets each machine use a verified installer from the vendor.

| Program | Why | Windows 11 | macOS | Linux |
| --- | --- | --- | --- | --- |
| Node.js 24.12 or newer | runs the TypeScript directly (no build step) | `winget install --id OpenJS.NodeJS.LTS --exact` | `brew install node@24` | distribution packages or nodejs.org |
| ffmpeg and ffprobe, 7.0 or newer | assembly, finishing grade, loudness, quality checks; contact sheets need `drawtext` (a build with libfreetype) | `winget install --id Gyan.FFmpeg --exact` | `brew install ffmpeg` | `sudo apt install ffmpeg` |
| Microsoft Edge or Google Chrome | headless rendering of the `html` and `three` lanes | Edge ships with Windows 11 | Chrome or Edge | Chrome or Chromium |
| Blender 5.2 LTS (optional) | the `blender` lane | `winget install --id BlenderFoundation.Blender --version 5.2.3 --exact` (asks for administrator approval) | `brew install --cask blender` then confirm the version is 5.2.x | `sudo snap install blender --classic`, then confirm `blender --version` starts with 5.2 (the snap has no 5.2 track), or the blender.org 5.2 LTS archive |

Blender 5.2.3 installs to `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` on Windows. The MSI's SHA-256 is `a103d4ece8d9acffd2a95c9d8860355b1f209977cc983b4a3d1e1cfb441c8605`, the same value published in `blender-5.2.3.sha256` on download.blender.org; winget verifies it. Only 5.2.x is supported, because 4.5 and 5.x differ in the Python API in five places (see `docs/adr/0004-blender-lane-version-install-and-applier.md`). The skill never downloads Blender itself.

Environment variables `FFMPEG`, `BLENDER` and `CHROME` override discovery when a program lives somewhere unusual; each must point at the real executable, not a `.cmd` shim.

## File locations

- Programs: wherever their installer put them; `doctor` records the resolved paths in `tools.json` under the data directory.
- Data directory (`tools.json`, `assets.json` and `assets/` for downloaded HDRIs, `cache/<shot key>/frames/` for rendered frames with their `manifest.json`, `profiles/` for the throw-away browser profiles, the optional narration component): `%LOCALAPPDATA%\VisionForge` on Windows, `~/Library/Application Support/VisionForge` on macOS, `~/.local/share/vision-forge` on Linux, or the `--data-dir` argument. When Claude runs the skill it passes its own plugin data directory as `--data-dir`, so a command you run by hand without `--data-dir` keeps a separate tool manifest and cache. To share them, pass the same `--data-dir` the skill uses (Claude Code shows it as `${CLAUDE_PLUGIN_DATA}`), or set `VISION_FORGE_DATA`.
- Render output: the `--out` argument, default `out/` under the current folder. Frames, logs and profiles stay under the data directory with short paths; only deliverables go to `out/`.
- `assemble` writes the delivery at the plan's output path, a `<name>.srt` beside it when the plan has captions, and a `.assemble-<name>/` scratch folder beside it holding `mix.wav`, `mix.log`, `loudnorm.log` and `encode.log`; the folder is removed on success and kept on failure, and the error names it. On failure the half-written delivery and the copied `.srt` are removed. The folder is also kept when loudness normalization prints no final measurement; a warning then names `encode.log`.
- `qa` writes its report to `--report`, by default `<out>/qa/<video name>.qa.json`. `sheet` writes `<out>/sheets/<source name>.png` unless `--output` names a file.
- `plan` writes `<out>/<jobId>/` with copies of the four documents and `job.json`; `still` adds `stills/<shot>-r<round>.png` (graded), `.raw.png`, `.gate.json` and, with `--scale 2`, `-2x.png`; `render` fills `cache/<key>/frames/` under the data directory and records the manifest path in `job.json`; `assets --credits` writes `<out>/CREDITS.md`.
- Fonts: Inter, Space Grotesk, Playfair Display and JetBrains Mono are bundled under `skills/cinematic-studio/assets/fonts/` (SIL Open Font License 1.1, texts beside the files) and served to the browser by the harness; nothing is installed into the operating system.

## Narration (optional)

Narration uses Kokoro-82M on the CPU through `kokoro-js`. It is not installed with the repository because its package chain is about 425 MB and contains components under GPL-3.0 (eSpeak NG), LGPL-3.0 (libvips) and a proprietary Microsoft DirectML library that is present but not used. `node scripts\cli.ts audio install --data-dir <dir>` prints the sizes and the licenses and stops; `audio install --yes` then copies the component's package.json and lockfile into `<data>\narration\`, runs `npm ci --ignore-scripts` there through node and npm-cli.js (never npm.cmd), downloads the four model files (92 MB) pinned to one commit and verified by SHA-256 through the allowlisted downloader, records them in the data directory's asset ledger and writes `narration\provenance.json`; about 11 s here on a warm npm cache. `audio status` says what is on disk, `audio voices` lists the four offered voices, `audio install --yes --verify` re-hashes the weights. You can skip narration entirely and supply your own recording.

## Troubleshooting

- **`doctor` says Blender is missing after installing it**: open a new terminal so PATH is refreshed, or set `BLENDER` to the full path of `blender.exe`. Microsoft Store builds are not supported; use the winget or blender.org installer.
- **`doctor` warns that ffmpeg is missing `drawtext` or `tile`**: the lanes still run; only `sheet` (contact sheets) needs them. Static builds without libfreetype lack `drawtext`; install a full build (the Gyan build on Windows, Homebrew's ffmpeg on macOS, the distribution package or a BtbN GPL build on Linux) and run `doctor` again.
- **`doctor` refuses the Blender version**: only 5.2.x is supported. Install 5.2.3 with the command above; two versions can coexist.
- **Blender renders fail with "Cannot initialize the GPU"**: EEVEE needs an interactive desktop session. Over some SSH or scheduled-task sessions only Cycles works; the still gate falls back to it and says so.
- **The `three` lane reports a software renderer**: headless Edge and Chrome use the GPU by default on Windows; a mismatch means the driver or an enterprise policy blocked it. The renderer policy can be set to `software` explicitly.
- **Edge refuses to start headless**: an enterprise policy can disallow headless mode; `doctor` then uses Chrome.
- **`still` or `render` fails with `page-init` or `page-seek`**: the message is the page's own sentence (a font that did not load, an animation left running, a frame without a baked camera) followed by the last console errors. Run with `--verbose` to see every page console line.
- **`render` says `shot-not-approved`**: every shot goes through `still` and `still --approve` first; `--allow-unapproved` skips the gate for a test render only.
- **`render` says `render-profile-mismatch`**: the still gate pinned a renderer (hardware or software) and the `--renderer` given disagrees; pass `--renderer any` or run `still` again with the renderer you want.
- **Paths too long**: keep the clone and `--out` short, or enable long paths in Windows. The program refuses early with a hint rather than failing mid-render.
- **`npm ci` fails**: use Node 24.12 or newer (`node --version`) and delete `node_modules` before retrying.
- **`sheet` fails inside ffmpeg with an access violation or a fontconfig error**: the Windows ffmpeg build has no fontconfig configuration and crashes when two or more `drawtext` filters run without a font file. The contact sheet passes a system font automatically (Segoe UI from `%WINDIR%\Fonts` on Windows, Arial or Helvetica on macOS, DejaVu Sans on Linux); on a machine without that font, install one of them.

Installer runs still depend on winget, network access and normal installer permissions. The setup script changes nothing without `-Install`.
