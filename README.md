# QuantumSolutions.Vision.Forge

Vision.Forge is a Claude Code skill that turns an English prompt into a finished video or still using only code. It renders titles and explainers with HTML and CSS, stylized 3D with Three.js, and near-photoreal objects with Blender, then assembles and checks the result with ffmpeg. Claude directs the shots, reviews rendered contact sheets and fixes what fails. No image or video generation model is involved; the one optional model is a small local voice for narration.

**Status: v0.1.0.** Every planned milestone (M0a to M8) is complete; two of the three blind-test pieces have been produced from their prompts through the commands alone. What is verified and what is not is in [docs/handoff.md](docs/handoff.md).

## Which page to read

| You are | Read |
| --- | --- |
| new to all of this and want a video | [docs/getting-started.md](docs/getting-started.md): install three programs, add the plugin, type one line, play the MP4 |
| installing on a new PC, macOS or Linux | [docs/SETUP.md](docs/SETUP.md): every program, why it is separate, where files go, troubleshooting |
| connecting another AI app (Claude Desktop, Cursor, Copilot, Codex, Gemini) | [docs/SETUP.md, "Use it from other AI apps (MCP)"](docs/SETUP.md#use-it-from-other-ai-apps-mcp): the launch command and a config snippet per app |
| a developer who wants to run, steer or extend it | this page, then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/adr/](docs/adr/) |
| the owner, testing a release | [docs/owner-test-guide.md](docs/owner-test-guide.md), then [docs/milestone-notes.md](docs/milestone-notes.md) |

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
| ffmpeg and ffprobe, 7.0 or newer | assembly, finishing, quality checks; contact sheets need a build with `drawtext` (libfreetype), which the full builds below have | `winget install --id Gyan.FFmpeg --exact` | about 90 MB |
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

Other AI apps connect through MCP: see [docs/SETUP.md, "Use it from other AI apps (MCP)"](docs/SETUP.md#use-it-from-other-ai-apps-mcp) for the launch command (`node <clone>/scripts/mcp.ts --out <dir>`) and the config snippet for Claude Desktop, Cursor, VS Code, Codex CLI and Gemini CLI.

## Commands

`node scripts/cli.ts <command> [options] --data-dir <dir> --out <dir>` prints one JSON result on standard output and its progress on standard error. Exit codes are 0 for success, 1 for failure, 2 for a usage error and 130 when cancelled. `help` prints the live table.

| Command | What it does |
| --- | --- |
| `doctor [--require <lane>] [--skip-browser-check] [--skip-blender-probe]` | finds Node, ffmpeg, ffprobe, Edge or Chrome, the GPU and Blender 5.2; writes `tools.json` under the data directory; reports which lanes (`html`, `three`, `blender`, `audio`) can run and the install command for anything missing |
| `plan --brief <f> --treatment <f> --shot-spec <f> --look <f>` | validates the four documents, checks them against each other and the pacing rules, runs the composition solver's checks on every shot, and writes the job folder with one key per shot |
| `still --job <folder> --shot <id> [--frame <k>] [--renderer hardware\|software\|any] [--scale <n>] [--approve]` | renders one graded frame of a shot for review, runs the still gate (composition, the browser's text measurement, contrast behind every text box, exposure) and pins the renderer; `--approve` marks a passed still approved |
| `render --job <folder> [--shot <id>] [--renderer ...] [--frames <a-b>] [--force] [--allow-unapproved]` | renders every frame of the approved html shots into the cache with a render manifest (pixel hashes, fingerprint); resumable and reused when nothing changed |
| `assets [--list] [--fetch <id,id>] [--all] [--verify] [--credits]` | the pinned catalogue of CC0 Poly Haven HDRIs: download with size and MD5 verification into the data directory, record the ledger, verify, write `CREDITS.md` |
| `validate <file>` | checks a JSON document (brief, treatment, shot spec, look bible, job, assembly plan, QA report, assets ledger, tools manifest or render manifest) against its schema and the semantic rules of its kind |
| `assemble --plan <assembly-plan.json>` | joins clips with cuts and transitions, mixes narration and music, writes or burns captions, applies the finishing grade and encodes H.264, HEVC or ProRes; verifies the exact frame count, rate, size and square pixels with ffprobe |
| `qa --video <file> [--plan <file>] [--text-boxes <json>] [--still <png> --still-frame <k>] [--report <file>] [--loudness-target <LUFS>] [--no-fail]` | measures dimensions, frame rate, duration, black and frozen frames, pops, exposure drift, text contrast, loudness, true peak and the hero still match; writes a QA report |
| `sheet --frames <dir or json> \| --video <file> [--every <n>] [--output <png>] [--columns <n>] [--thumb-width <px>]` | tiles labelled frames, or every nth frame of a delivery, into one contact sheet |
| `audio install [--yes] [--verify]`, `audio status`, `audio voices`, `audio synth --text <sentences> \| --script <file> [--voice <name>] [--fps <n>]` | the optional narration component: installs it into the data directory after showing the sizes and licenses (ADR 0007), reports its state, lists the voices, and turns text into a loudness-normalized WAV with per-sentence frame timings and an SRT |

Two pieces of `docs/blind-test.md` were produced from their prompts through the commands alone: the 15-second product film (`skills/cinematic-studio/examples/product-film/`, record `docs/evidence/m7/`) and the 45-second narrated explainer (`skills/cinematic-studio/examples/explainer/`, record `docs/evidence/explainer/`). v0.1.0 is packaged (M8); the title sequence is the owner's prompt.

## Getting the most out of it

### Write the prompt the way a director would brief

The skill fills a questionnaire from your words and takes a default for anything you leave out, so the more of these you say, the less it guesses: the use case (a product shot, an explainer, a title sequence, a lower third, kinetic type), the length in seconds, the frame (16:9, 9:16, 1:1), the tempo (calm, dynamic), the mood, a palette hint, the subject and what it is made of, the text that must appear verbatim in quotes, whether it loops, whether it is narrated or captioned, and whether you have music. The defaults per use case are in `skills/cinematic-studio/references/direction/treatment-template.md`.

### Read the treatment before anything renders

The one-page treatment is the contract: the look and why, the beats with a lane and a length each, and the substitutions (what the lanes cannot do literally and what they do instead, from `references/direction/steering-table.md`). Change it there. A still costs five seconds and a full render costs minutes, so the cheapest place to steer is the treatment, the next cheapest is the still loop.

### Know what each lane is for

- `html`: type, cards, charts, lower thirds, kinetic text, 2.5D stages. Fastest (about 110 ms per 1080p frame) and the only lane for text, so a title over a 3D shot is an html plate composited over it.
- `three`: stylized 3D, the subject's primitives under the cookbook's rigs, depth of field, motion blur, bloom. Works everywhere a browser runs.
- `blender`: the most physical image (EEVEE, or Cycles when EEVEE cannot start), seconds per frame. Chosen for product shots when Blender 5.2 is installed.

Subjects are stand-ins built from primitives (a bottle is cylinders, a card a slab) in the look's materials; the treatment says so. Glass, liquid and brushed textures are suggested, not shown.

### Pick a look, then change at most two things

Seven presets ship (`studio-clean`, `obsidian`, `warm-editorial`, `neon-tech`, `paper-flat`, `noir-title`, `sunset-gradient`), each a palette, a font pairing, a rig, a tone mapping and a grade with its own QA exposure band (`references/color/look-bible.md`). Name colours or fonts in the prompt and the skill starts from the nearest preset and changes the palette plus at most two other tokens; it says which. The lookdev sheet of all seven is `docs/evidence/m4/`.

### Use the still loop

Every shot renders one graded still through the same path the render takes, and a gate measures it (composition, type sizes, contrast behind every text box, exposure in the look's band). Then the skill names three faults and fixes what is cheap. You can join in: ask for a 4K still of the hero (`still --scale 2`), ask for a contact sheet of all the stills, or say what to change. Three rounds per shot, then the design changes, not the numbers.

### Narration first, then durations

For a narrated piece the sentences are the clock: the voice is synthesized before the shot list is written and every cut lands on a sentence boundary. The local voice (`af_heart` and three others, English only) installs once on your yes; or hand the skill a WAV of your own recording. Captions come from the voice's own timings, as an SRT beside the delivery or burnt in, set in the look's face and colours.

### Trust the cache and the determinism

A shot's key is the hash of its spec, the look, the lane's code and the renderer's major version. Frames live under the data directory by key, so a re-plan after an edit re-renders only the shots whose key changed, and a cancelled render resumes. The same inputs give the same pixels on the same machine; across machines the gates compare by SSIM. A job's id is the hash of its four documents, so an edit plans into a new folder and the old one keeps its rounds.

### Run the commands yourself

Everything the skill does is `node scripts/cli.ts <command> --data-dir <dir> --out <dir>` with one JSON result on standard output. Pass the same `--data-dir` the skill uses (Claude Code's plugin data directory for `vision-forge`) to share its tool record, HDRIs, voice and frame cache; `--pretty` makes a result readable, `--verbose` shows every page console line. The two shipped examples under `skills/cinematic-studio/examples/` list the exact command sequence of a blender product film and a narrated html explainer, and `docs/evidence/` records each with timings.

### Extend it

- A new look: a preset in `src/shared/look/presets.ts` and a row in the look bible; the parity test keeps the lanes within a few YAVG of each other.
- A new camera move or text animation: `src/shared/camera/` and `src/shared/typography/`, with a row in the matching reference table; the vocabulary lives once in `schemas/` and is generated into `src/shared/contracts/` by `npm run schema:gen`.
- A new check: `src/qa/` for the delivery, `src/render/still-gate` for the still; every check reports a measured value, a threshold and a sentence.
- The rules every file follows are in `AGENTS.md`; `npm run check` runs the type checks, the house-rules lint, the schema drift check, the license allowlist and the suite. Decisions and their reasons are in `docs/adr/`.

### From other AI apps

The same studio is an MCP server: `node scripts/mcp.ts --data-dir <dir> --out <dir>` over stdio, launched by the app (ADR 0009). Every tool is a command run in-process through `src/cli/run.ts`, so a tool call and a command line do exactly the same thing and return the same JSON result; `plan` takes the four documents inline for apps that cannot write files; `still` and `sheet` return the picture as an image; `render` runs as a task polled with `task_status`. The knowledge base is served as `vision-forge://` resources and the directing flow as the `cinematic-studio` prompt, so an app's model follows the same questionnaire, treatment gate, still loop and QA a Claude Code session does; how well it directs depends on how well its model follows that prompt. The config snippets per app are in [docs/SETUP.md](docs/SETUP.md#use-it-from-other-ai-apps-mcp).

## Project layout

- `scripts/cli.ts` is the only program the skill calls; `scripts/lint.ts`, `scripts/gen-types.ts` and `scripts/licenses.ts` are the repository's own checks; `scripts/probes/` holds the machine probes that produced the evidence under `docs/evidence/`.
- `src/shared/` is TypeScript that runs both in Node and in the browser: generated contracts, hashing, WCAG contrast (`color/`), the finishing grade and its `.cube` LUT (`grade/`), the easing tokens and timeline combinators (`motion/`), the physical camera model and move catalogue (`camera/`, including the CSS 3D transform of the html stage), the composition solver and its checks (`composition/`), the calibration scene (`calibration/`), the page protocol (`harness/`), the type scale, text animations and text fit (`typography/`), the lighting rigs and their placement (`lighting/`), the look's CSS tokens and the seven look presets (`look/`), the html lane's pure style functions (`html/`), the three lane's pure numbers (`three/`: the camera mapping, sub-frames, light intensities, materials, the calibration scalars) and the subject's primitives (`subject/`).
- `src/browser/` runs in the page: the runtime that installs the `__vfInit`/`__vfSeek` protocol (`runtime/`), the html lane (`html/`) and the three lane (`three/`: renderer, scene, lights, subject, environment, atmosphere and the post pipeline); `src/calibration/` renders and measures the calibration scene and the lookdev stills for the probes and the parity test; `src/lanes/` holds the Node side of each lane (the page document, the lane code hash); `src/render/` orchestrates a shot's frames, manifest, cache and the still gate; `src/assets/` holds the asset catalogue and its downloads.
- `src/cli/`, `src/errors/`, `src/process/`, `src/fs/`, `src/net/`, `src/harness/` (the loopback server and the Playwright browser session), `src/schema/`, `src/tools/`, `src/plan/`, `src/finishing/`, `src/assemble/`, `src/qa/`, `src/sheet/`, `src/lint/` and `src/licenses/` are the Node-side infrastructure.
- `Setup-VisionForge.cmd`, `scripts/setup.ps1` and `scripts/setup.sh` are the setup scripts a person runs once; they never prompt and install nothing without `-Install`.
- `schemas/` holds the JSON Schema contracts; `src/shared/contracts/` is generated from them and checked for drift in CI.
- `blender/apply_scene.py` is the only Python file; it applies a fully resolved scene and makes no decisions. `src/lanes/blender/` is the Node side: the resolver that turns a shot, its look, its baked camera and its environment into the scene document, the runner with Blender's exact command line, the attempt ladder, the success predicate, the estimator and the batches; `src/render/blender-shot.ts` renders a shot through them into the same cache and manifest the browser lanes use.
- `skills/cinematic-studio/` holds the skill, its creative knowledge base and the four bundled OFL fonts (`assets/fonts/`, with their license texts and provenance); HDRIs are downloaded into the data directory by the `assets` command, never committed.
- `docs/adr/` records every decision and why; `docs/research.md` lists every fact with its source and status; `docs/evidence/` holds probe output with numbers.

## Verified so far on the owner's machine

Node 24.13.0, TypeScript 6.0.3, ffmpeg 9.0.2, Edge 156 and Chrome 156 on Windows 11 with an RTX 2060:

- Shared TypeScript is served to the browser through Node's own type stripper with an import map; Three.js and its addons load (`docs/evidence/m0/p3-tsserve.md`).
- Headless Edge and Chrome use the NVIDIA Direct3D 11 renderer by default; software renderers can be selected by flag and are recognizable by name (`docs/evidence/m0/p4-webgl.md`).
- Ten renders of the same page gave byte-identical frames, and Chrome matched Edge pixel for pixel; one 1080p screenshot takes about 50 ms (`docs/evidence/m0/p5-determinism.md`).
- ffmpeg's finishing and QA filters behave as the design needs (`docs/evidence/m0/p6-ffmpeg.md`).
- `doctor` exits 0 here with the `html`, `three` and `audio` lanes available: both browsers report WebGL2 on the NVIDIA Direct3D 11 renderer, and the absent Blender is reported with its install command.
- The html lane's title card renders byte-identically in ten fresh browser launches, the still gate passes the reference fixture (contrast 11.2:1, luma 33 inside the look's band), and a 600-frame 1080p shot renders in 66 s (`docs/evidence/m3/`).
- The product film of `docs/blind-test.md` (four shots on the blender lane, 450 frames at 1080p, a text plate for the title) was made from its prompt in 31 minutes of wall clock through the commands only, passes every QA check, and loops (`docs/evidence/m7/`).
- `assemble` turns synthetic clips into deliveries with exact frame counts across cuts, dissolves, wipes and fades, lands loudness within 1 LU of the target and applies a `.cube` grade; `qa` finds the planted black and frozen frames, pops and quiet audio in synthetic clips (the M1 section of `docs/handoff.md`).

## Limits

- No photoreal people, faces or animals, and no live-action look. The skill says so and proposes a stylized or abstract alternative.
- Frames are reproducible on the same machine with the same browser, driver and settings. They are not byte-identical across machines; quality gates use SSIM and PSNR.
- Blender needs an interactive desktop session for EEVEE; without one the lane falls back to Cycles.
- Music is user-supplied or absent; no music source on the internet satisfies the project's no-key, allowlisted-host rule.
- Narration is English only and installs a separately licensed component on request (see `docs/adr/0007-narration-as-an-opt-in-component.md`).
- Every clip is normalized to 8-bit 4:2:0 before the join, so a ProRes delivery is 10-bit 4:2:2 in its container only; HEVC and ProRes are offered as containers, not as extra precision.
- The subject is a stand-in built from primitives (a bottle is a stack of cylinders; a box, a pill, a card); glTF models are not imported yet, and frosted glass or brushed metal are suggested by colour and roughness, not shown.
- A job is keyed on its four documents: every edit during the still loop plans into a new job folder, and approvals restart there (the render cache keeps the frames).
- Text on a three or blender shot is one plate per shot, laid over the picture after the grade; a three-dimensional title is not offered.
- The three blind-test pieces are judged by the owner; the product film and the explainer are made, the title sequence is the next prompt to run.
- An explainer's "diagram" is typographic: one labelled card per step on a 2.5D stage, with the numbers, names and hashes as type; no arrows, icons or connected boxes are drawn.

## Current non-goals

- Parity claims with Higgsfield or any generative video service.
- Physics simulation, character animation, photoreal environments.
- Publishing to npm (Node refuses to run TypeScript from `node_modules`).
- Running the Blender lane on continuous-integration runners.

## License

Apache-2.0 (see `LICENSE` and `NOTICE`). Third-party components and their licenses are listed in `THIRD-PARTY.md`, generated by `node scripts/licenses.ts --write` and checked against an allowlist in CI; verbatim license texts of the runtime dependencies are under `docs/licenses/`.
