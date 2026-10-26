# QuantumSolutions.Vision.Forge

Vision.Forge is a Claude Code skill that turns an English prompt into a finished video or still using only code. It renders titles and explainers with HTML and CSS, stylized 3D with Three.js, and near-photoreal objects with Blender, then assembles and checks the result with ffmpeg. Claude directs the shots, reviews rendered contact sheets and fixes what fails. No image or video generation model is involved; the one optional model is a small local voice for narration.

**Status: under construction.** Milestones M0a (research, probes and decisions) and M0b (core infrastructure, checks and packaging) are complete; the CLI runs but nothing renders a film yet. The current state and everything not yet verified are in [docs/handoff.md](docs/handoff.md).

## What it will do

- Take a brief such as "a 15-second studio product film of a frosted-glass bottle" and produce a treatment, a shot list with real camera, lens, lighting and composition parameters, one still per shot for review, the full render, and an H.264 delivery.
- Keep one look across every shot and lane: one physical camera model, one lighting cookbook, one finishing grade.
- Render deterministically: a frame is a function of its frame number, and the same inputs on the same machine produce the same pixels.
- Say what it cannot do and offer a stylized alternative.

## Required programs

The repository ships source only. These programs are installed separately and called as external programs. `node scripts/cli.ts doctor` (milestone M1) reports what is missing and the exact install command.

| Program | Purpose | Install on Windows 11 | Size |
| --- | --- | --- | --- |
| Node.js 24.12 or newer | runs everything; no build step | `winget install --id OpenJS.NodeJS.LTS --exact` | about 60 MB |
| ffmpeg and ffprobe | assembly, finishing, quality checks | `winget install --id Gyan.FFmpeg --exact` | about 90 MB |
| Microsoft Edge or Google Chrome | renders the `html` and `three` lanes headlessly | Edge ships with Windows 11 | — |
| Blender 5.2 LTS | renders the `blender` lane (optional; the other lanes work without it) | `winget install --id BlenderFoundation.Blender --version 5.2.3 --exact` | about 350 MB |

macOS and Linux use Homebrew, apt or snap for the same programs; see [docs/SETUP.md](docs/SETUP.md). Only Blender 5.2.x is supported; other versions are refused with the install command above.

## Quick start (after milestone M1)

```powershell
git clone https://github.com/JackTelford/QuantumSolutions.Vision.Forge.git
cd QuantumSolutions.Vision.Forge
.\Setup-VisionForge.cmd
node scripts\cli.ts doctor
```

Then install the plugin into Claude Code:

```powershell
claude plugin marketplace add JackTelford/QuantumSolutions.Vision.Forge
claude plugin install vision-forge@quantum-solutions
```

The skill is then available as `/vision-forge:cinematic-studio`. While developing, `claude --plugin-dir <path to the clone>` loads the working tree instead of the cached copy.

## Project layout

- `scripts/cli.ts` is the only program the skill calls; `scripts/lint.ts`, `scripts/gen-types.ts` and `scripts/licenses.ts` are the repository's own checks; `scripts/probes/` holds the machine probes that produced the evidence under `docs/evidence/`.
- `src/shared/` is TypeScript that runs both in Node and in the browser: generated contracts, hashing, and (from M2) camera, easing, timeline, composition and grade.
- `src/cli/`, `src/errors/`, `src/process/`, `src/fs/`, `src/net/`, `src/harness/`, `src/schema/`, `src/lint/` and `src/licenses/` are the Node-side infrastructure; `src/browser/`, `src/lanes/`, `src/finishing/`, `src/assemble/` and `src/qa/` arrive with milestones M1 to M6.
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

## Limits

- No photoreal people, faces or animals, and no live-action look. The skill says so and proposes a stylized or abstract alternative.
- Frames are reproducible on the same machine with the same browser, driver and settings. They are not byte-identical across machines; quality gates use SSIM and PSNR.
- Blender needs an interactive desktop session for EEVEE; without one the lane falls back to Cycles.
- Music is user-supplied or absent; no music source on the internet satisfies the project's no-key, allowlisted-host rule.
- Narration is English only and installs a separately licensed component on request (see `docs/adr/0007-narration-as-an-opt-in-component.md`).

## Current non-goals

- Parity claims with Higgsfield or any generative video service.
- Physics simulation, character animation, photoreal environments.
- Publishing to npm (Node refuses to run TypeScript from `node_modules`).
- Running the Blender lane on continuous-integration runners.

## License

Apache-2.0 (see `LICENSE` and `NOTICE`). Third-party components and their licenses are listed in `THIRD-PARTY.md`, generated by `node scripts/licenses.ts --write` and checked against an allowlist in CI; verbatim license texts of the runtime dependencies are under `docs/licenses/`.
