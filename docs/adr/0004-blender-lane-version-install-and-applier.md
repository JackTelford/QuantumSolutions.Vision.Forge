# ADR 0004: Blender lane — 5.2 LTS only, installed by the user, driven by a logic-free applier

Status: accepted, 2026-10-26. Owner decisions recorded the same day: install through winget, 5.2 LTS only.

## Context

Blender is not installed on the owner's machine. The current stable release is 5.2.3 LTS (2026-10-22), supported for two years; 4.5 LTS is supported until July 2027 ([LTS page](https://www.blender.org/download/lts/), [release index](https://developer.blender.org/docs/release_notes/)). The two LTS lines differ in the Python API in five places that would all need branches in the one Python file: the EEVEE engine id (`BLENDER_EEVEE_NEXT` in 4.2–4.5, `BLENDER_EEVEE` in 5.0+), the Action API (legacy `action.fcurves` removed in 5.0), `ImageFormatSettings.media_type` (5.x only, must be set before `file_format`), `Scene.node_tree` versus `Scene.compositing_node_group`, and the bundled Python (3.11 versus 3.13) ([5.0 Python API notes](https://developer.blender.org/docs/release_notes/5.0/python_api/)).

Binaries cannot ship in the repository (BUILD PROMPT, GitHub's 100 MiB limit) and the skill runtime may not download Blender (`download.blender.org` is not on the network allowlist; downloaded code is never executed). The winget package `BlenderFoundation.Blender` 5.2.3 is an MSI that elevates itself and installs to `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`; its SHA-256 (`a103d4ec…8605`) equals the one in `blender-5.2.3.sha256` on download.blender.org ([winget manifest](https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/b/BlenderFoundation/Blender/5.2.3/BlenderFoundation.Blender.installer.yaml)). The MSI writes no install-path registry value; its ProgID `blender.5.2\shell\open\command` points at `blender-launcher.exe`, which starts `blender.exe` in a new console (stdout not capturable). Microsoft Store builds live under `WindowsApps` and expose only a launcher alias.

From the 5.2 source: background mode on Windows creates an offscreen WGL context on a hidden window when EEVEE or Workbench renders, so an interactive desktop session is needed; Workbench needs the GPU context too, so Cycles is the only no-context fallback; `--gpu-backend` is parsed in the environment pass and works under `-b` (5.2 defaults to OpenGL on Windows x64, 5.3 switches to Vulkan); `--python-exit-code` is applied in command-line order and must precede `-P`; a Python exception without it exits 0; some pre-render failures exit 0 with no file; a crash in background mode exits `0xC0000005` after writing `%TEMP%\blender.crash.txt`, and open issue [#165595](https://projects.blender.org/blender/blender/issues/165595) reports such a crash at teardown after successful work in 5.2.3. `hasattr(bpy.types.X, 'prop')` never sees RNA properties; feature probes must use `bl_rna.properties`.

## Decision

1. **Version**: 5.2.x only. `doctor` parses `blender.exe --version` and rejects any other major.minor with the exact install command.
2. **Install**: the user runs `Setup-VisionForge.cmd` / `scripts/setup.ps1 -Install` (winget, UAC prompt, ~350 MB) or `scripts/setup.sh` (brew cask on macOS; apt or snap hint on Linux). `doctor` exits 1 with the same command when Blender is missing. SKILL.md tells Claude to run `doctor` first and to continue with the html and three lanes when Blender is absent.
3. **Discovery order**: `BLENDER` environment variable → `%ProgramFiles%\Blender Foundation\Blender 5.2\blender.exe` → registry ProgID command with `blender-launcher.exe` replaced by `blender.exe` → PATH. Paths under `\WindowsApps\` are rejected. `doctor` records the path, version and SHA-256 of `blender.exe` in `tools.json`.
4. **Invocation** (golden-tested argv): `blender.exe -b --factory-startup --disable-autoexec -noaudio --offline-mode --gpu-backend <opengl|vulkan> --python-exit-code 3 [--python-expr "import gpu; gpu.init()"] -P blender/apply_scene.py -- <scene.json> <outdir>` with `BLENDER_USER_RESOURCES` pointed at our data directory so user preferences and add-ons cannot change renders. The `gpu.init()` preflight is appended by TypeScript only for EEVEE attempts; Cycles attempts need no GPU context.
5. **Applier**: `blender/apply_scene.py` reads a fully resolved `scene.json` (closed schema: every property required, no defaults, units in descriptions) and makes bpy calls with one comment per call. No math, no decisions, no version checks. A test parses the file and fails on branching tokens.
6. **Engine choice at the still gate only**: the attempt ladder EEVEE/OpenGL → EEVEE/Vulkan → Cycles OptiX → Cycles CUDA → Cycles CPU runs inside `still`; the winning profile is written into the shot spec and therefore into the shot hash; `render` refuses to switch engines. Cycles CPU is legal for stills only. 4K hero stills use Cycles OptiX with denoising.
7. **Success predicate**: exit 0 (or the documented teardown crash with every frame present and newer than the spawn) **and** every expected PNG exists **and** `ffprobe signalstats` is not black **and** no new crash log. Exit 3 means a Python exception; exit 1 a Blender render failure; the error carries the stderr tail and the crash-log path.
8. **Motion**: baked per-frame keyframes through `obj.keyframe_insert(data_path, frame=)` with `keyframe_new_interpolation_type = 'LINEAR'`, which is unchanged across 4.x and 5.x and enables motion blur. Strategy (b) from BUILD PROMPT §6.8.
9. **Assets**: Poly Haven models are imported as glTF, never opened as `.blend` (which can carry scripts).

## Evidence

All findings above come from reading the `blender-v5.2-release` source and the release notes; nothing has run locally because Blender is absent. The M5 acceptance script (engine list, `bl_rna` probe, non-black EEVEE frame from a Node child process under both backends, Cycles OptiX frame, exit-code matrix, crash-log check) must pass before any scene work starts.

## Consequences

- One Python file, no version branches, reviewable by a non-Python reader.
- A machine without an interactive session (service, some SSH logons) gets Cycles only; the README says so.
- When 5.3 ships with Vulkan as default, the pin stays until 5.3 is proven under `-b`; `--gpu-backend` is always explicit.
