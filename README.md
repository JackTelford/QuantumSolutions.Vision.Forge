# QuantumSolutions.Vision.Forge

Vision.Forge is a Claude Code skill that turns an English prompt into a finished video or still using only code. It renders titles and explainers with HTML and CSS, stylized 3D with Three.js, and near-photoreal objects with Blender, then assembles and checks the result with ffmpeg. Claude directs the shots, reviews rendered contact sheets and fixes what fails. No image or video generation model is involved; the one optional model is a small local voice for narration.

**Status: under construction.** Milestones M0a (research, probes and decisions), M0b (core infrastructure, checks and packaging) and M1 (contracts, doctor, assemble, QA and contact sheets) are complete. The CLI finds the tools, validates every pipeline document, assembles clips into a graded delivery and measures it; nothing renders a frame yet. The current state and everything not yet verified are in [docs/handoff.md](docs/handoff.md).

## What it will do

- Take a brief such as "a 15-second studio product film of a frosted-glass bottle" and produce a treatment, a shot list with real camera, lens, lighting and composition parameters, one still per shot for review, the full render, and an H.264 delivery.
- Keep one look across every shot and lane: one physical camera model, one lighting cookbook, one finishing grade.
- Render deterministically: a frame is a function of its frame number, and the same inputs on the same machine produce the same pixels.
- Say what it cannot do and offer a stylized alternative.

## Required programs

The repository ships source only. These programs are installed separately and called as external programs. `node scripts/cli.ts doctor` reports what is missing and the exact install command.

| Program | Purpose | Install on Windows 11 | Size |
| --- | --- | --- | --- |
| Node.js 24.12 or newer | runs everything; no build step | `winget install --id OpenJS.NodeJS.LTS --exact` | about 60 MB |
| ffmpeg and ffprobe | assembly, finishing, quality checks | `winget install --id Gyan.FFmpeg --exact` | about 90 MB |
| Microsoft Edge or Google Chrome | renders the `html` and `three` lanes headlessly | Edge ships with Windows 11 | — |
| Blender 5.2 LTS | renders the `blender` lane (optional; the other lanes work without it) | `winget install --id BlenderFoundation.Blender --version 5.2.3 --exact` | about 350 MB |

macOS and Linux use Homebrew, apt or snap for the same programs; see [docs/SETUP.md](docs/SETUP.md). Only Blender 5.2.x is supported; other versions are refused with the install command above.

## Quick start

```powershell
git clone https://github.com/JackTelford/QuantumSolutions.Vision.Forge.git
cd QuantumSolutions.Vision.Forge
.\Setup-VisionForge.cmd
```

`Setup-VisionForge.cmd` prints a table of the required programs with the exact install command under each missing one. When everything is present it runs `npm ci --ignore-scripts` and `node scripts\cli.ts doctor`. It installs nothing unless you pass `-Install`; add `-SkipBlender` to leave Blender out (the `html` and `three` lanes work without it), or `-CheckOnly` to print the table and stop. It never asks for input. On macOS and Linux run `scripts/setup.sh` with `--install`, `--skip-blender` or `--check-only`; there `--install` calls `sudo`, which may ask for your password. Afterwards `node scripts\cli.ts doctor` can be run at any time: exit code 0 means every required program was found, and its output lists which lanes can run.

Then install the plugin into Claude Code:

```powershell
claude plugin marketplace add JackTelford/QuantumSolutions.Vision.Forge
claude plugin install vision-forge@quantum-solutions
```

The skill is then available as `/vision-forge:cinematic-studio`. While developing, `claude --plugin-dir <path to the clone>` loads the working tree instead of the cached copy.

## Commands

`node scripts/cli.ts <command> [options] --data-dir <dir> --out <dir>` prints one JSON result on standard output and its progress on standard error. Exit codes are 0 for success, 1 for failure, 2 for a usage error and 130 when cancelled. `help` prints the live table.

| Command | What it does |
| --- | --- |
| `doctor [--require <lane>] [--skip-browser-check] [--skip-blender-probe]` | finds Node, ffmpeg, ffprobe, Edge or Chrome, the GPU and Blender 5.2; writes `tools.json` under the data directory; reports which lanes (`html`, `three`, `blender`, `audio`) can run and the install command for anything missing |
| `validate <file>` | checks a JSON document (brief, treatment, shot spec, look bible, job, assembly plan, QA report, assets ledger, tools manifest or render manifest) against its schema and the semantic rules of its kind |
| `assemble --plan <assembly-plan.json>` | joins clips with cuts and transitions, mixes narration and music, writes or burns captions, applies the finishing grade and encodes H.264, HEVC or ProRes; verifies the exact frame count, rate, size and square pixels with ffprobe |
| `qa --video <file> [--plan <file>] [--text-boxes <json>] [--still <png> --still-frame <k>] [--report <file>] [--loudness-target <LUFS>] [--no-fail]` | measures dimensions, frame rate, duration, black and frozen frames, pops, exposure drift, text contrast, loudness, true peak and the hero still match; writes a QA report |
| `sheet --frames <dir or json> [--output <png>] [--columns <n>] [--thumb-width <px>]` | tiles labelled frames into one contact sheet |

Planned: `plan` (M2); `still`, `render` and `assets` (M3); `audio` (M6).

## Project layout

- `scripts/cli.ts` is the only program the skill calls; `scripts/lint.ts`, `scripts/gen-types.ts` and `scripts/licenses.ts` are the repository's own checks; `scripts/probes/` holds the machine probes that produced the evidence under `docs/evidence/`.
- `src/shared/` is TypeScript that runs both in Node and in the browser: generated contracts, hashing, WCAG contrast (`color/`), the finishing grade and its `.cube` LUT (`grade/`), and (from M2) camera, easing, timeline and composition.
- `src/cli/`, `src/errors/`, `src/process/`, `src/fs/`, `src/net/`, `src/harness/`, `src/schema/`, `src/tools/`, `src/finishing/`, `src/assemble/`, `src/qa/`, `src/sheet/`, `src/lint/` and `src/licenses/` are the Node-side infrastructure; `src/browser/` and `src/lanes/` arrive with milestones M3 to M5.
- `Setup-VisionForge.cmd`, `scripts/setup.ps1` and `scripts/setup.sh` are the setup scripts a person runs once; they never prompt and install nothing without `-Install`.
- `schemas/` holds the JSON Schema contracts; `src/shared/contracts/` is generated from them and checked for drift in CI.
- `blender/apply_scene.py` is the only Python file; it applies a fully resolved scene and makes no decisions.
- `skills/cinematic-studio/` holds the skill, its creative knowledge base, bundled fonts and HDRIs.
- `docs/adr/` records every decision and why; `docs/research.md` lists every fact with its source and status; `docs/evidence/` holds probe output with numbers.

## Verified so far on the owner's machine

Node 24.13.0, TypeScript 6.0.3, ffmpeg 9.0.2, Edge 156 and Chrome 156 on Windows 11 with an RTX 2060:

- Shared TypeScript is served to the browser through Node's own type stripper with an import map; Three.js and its addons load (`docs/evidence/m0/p3-tsserve.md`).
- Headless Edge and Chrome use the NVIDIA Direct3D 11 renderer by default; software renderers can be selected by flag and are recognizable by name (`docs/evidence/m0/p4-webgl.md`).
- Ten renders of the same page gave byte-identical frames, and Chrome matched Edge pixel for pixel; one 1080p screenshot takes about 50 ms (`docs/evidence/m0/p5-determinism.md`).
- ffmpeg's finishing and QA filters behave as the design needs (`docs/evidence/m0/p6-ffmpeg.md`).
- `doctor` exits 0 here with the `html`, `three` and `audio` lanes available: both browsers report WebGL2 on the NVIDIA Direct3D 11 renderer, and the absent Blender is reported with its install command.
- `assemble` turns synthetic clips into deliveries with exact frame counts across cuts, dissolves, wipes and fades, lands loudness within 1 LU of the target and applies a `.cube` grade; `qa` finds the planted black and frozen frames, pops and quiet audio in synthetic clips (the M1 section of `docs/handoff.md`).

## Limits

- No photoreal people, faces or animals, and no live-action look. The skill says so and proposes a stylized or abstract alternative.
- Frames are reproducible on the same machine with the same browser, driver and settings. They are not byte-identical across machines; quality gates use SSIM and PSNR.
- Blender needs an interactive desktop session for EEVEE; without one the lane falls back to Cycles.
- Music is user-supplied or absent; no music source on the internet satisfies the project's no-key, allowlisted-host rule.
- Narration is English only and installs a separately licensed component on request (see `docs/adr/0007-narration-as-an-opt-in-component.md`).
- Every clip is normalized to 8-bit 4:2:0 before the join, so a ProRes delivery is 10-bit 4:2:2 in its container only; HEVC and ProRes are offered as containers, not as extra precision.

## Current non-goals

- Parity claims with Higgsfield or any generative video service.
- Physics simulation, character animation, photoreal environments.
- Publishing to npm (Node refuses to run TypeScript from `node_modules`).
- Running the Blender lane on continuous-integration runners.

## License

Apache-2.0 (see `LICENSE` and `NOTICE`). Third-party components and their licenses are listed in `THIRD-PARTY.md`, generated by `node scripts/licenses.ts --write` and checked against an allowlist in CI; verbatim license texts of the runtime dependencies are under `docs/licenses/`.
